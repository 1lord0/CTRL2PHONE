export interface PhoneFileSyncContext {
  readonly generation: number;
  readonly url: string;
  readonly bucket: string;
}

export interface RemotePhoneFile {
  readonly name: string;
  readonly id?: string | null;
  readonly updated_at?: string | null;
}

export interface PhoneFileSyncPorts<Context extends PhoneFileSyncContext, Subscription> {
  readonly isEnabled: () => boolean;
  readonly getContext: () => Context | null;
  readonly isContextCurrent: (context: Context) => boolean;
  readonly isSynced: (context: Context, path: string, file?: RemotePhoneFile) => boolean;
  readonly markSynced: (context: Context, path: string, file?: RemotePhoneFile) => void;
  readonly listRemoteFiles: (
    context: Context
  ) => Promise<{ readonly files: readonly RemotePhoneFile[]; readonly error: string | null }>;
  readonly downloadFile: (
    context: Context,
    file: RemotePhoneFile,
    batchIndex: number
  ) => Promise<string | null>;
  readonly deleteRemoteFile: (context: Context, path: string) => Promise<string | null>;
  readonly notifyDownloads: (paths: readonly string[]) => void;
  readonly subscribe: (
    context: Context,
    onFile: (file: RemotePhoneFile) => void,
    onSubscribed: () => void
  ) => Subscription;
  readonly removeSubscription: (subscription: Subscription) => Promise<void>;
  readonly log: (message: string) => void;
  readonly warn: (message: string, detail?: string) => void;
  readonly error: (message: string, error: Error) => void;
}

export interface PhoneFileSyncController {
  readonly check: () => Promise<void>;
  readonly syncPath: (path: string, file?: RemotePhoneFile) => Promise<void>;
  readonly setup: () => Promise<void>;
  readonly stop: () => void;
  readonly stopAndDrain: () => Promise<void>;
}

export function createPhoneFileSyncController<Context extends PhoneFileSyncContext, Subscription>(
  ports: PhoneFileSyncPorts<Context, Subscription>
): PhoneFileSyncController {
  let isStopped = false;
  let pollingInterval: NodeJS.Timeout | null = null;
  let subscription: Subscription | null = null;

  let currentOperationPromise: Promise<void> | null = null;
  let pendingCheck = false;
  const pendingSyncPaths = new Map<string, RemotePhoneFile | undefined>();
  let lifecycleTransition: Promise<void> = Promise.resolve();
  let shutdownRequested = false;
  let shutdownPromise: Promise<void> | null = null;

  const deleteRemote = async (context: Context, path: string): Promise<void> => {
    if (isStopped || !ports.isContextCurrent(context)) return;
    const error = await ports.deleteRemoteFile(context, path);
    if (error) ports.warn(`Phone sync: remote delete failed for ${path}:`, error);
  };

  const processFile = async (
    context: Context,
    file: RemotePhoneFile,
    batchIndex: number
  ): Promise<string | null> => {
    if (isStopped) return null;
    const path = `to_pc/${file.name}`;
    if (ports.isSynced(context, path, file)) {
      await deleteRemote(context, path);
      return null;
    }
    const localPath = await ports.downloadFile(context, file, batchIndex);
    if (!localPath || isStopped || !ports.isContextCurrent(context)) return null;
    ports.markSynced(context, path, file);
    await deleteRemote(context, path);
    return localPath;
  };

  const cleanupSynced = async (
    context: Context,
    files: readonly RemotePhoneFile[]
  ): Promise<void> => {
    for (const file of files) {
      if (isStopped || !ports.isContextCurrent(context)) return;
      if (!isValidRemotePhoneFile(file) || !isValidPhoneFileName(file.name)) continue;
      const path = `to_pc/${file.name}`;
      if (ports.isSynced(context, path, file)) await deleteRemote(context, path);
    }
  };

  const executeCheck = async (): Promise<void> => {
    if (isStopped || !ports.isEnabled()) return;
    const context = ports.getContext();
    if (!context || !ports.isContextCurrent(context)) return;

    try {
      const result = await ports.listRemoteFiles(context);
      if (result.error) {
        ports.warn('Phone sync list error:', result.error);
        return;
      }
      if (isStopped || !ports.isContextCurrent(context) || result.files.length === 0) return;
      const pending = result.files.filter((file) => {
        if (!isValidRemotePhoneFile(file)) {
          ports.warn('Phone sync: skipped remote file with invalid metadata (redacted)');
          return false;
        }
        if (!isValidPhoneFileName(file.name)) {
          ports.warn('Phone sync: skipped remote file with invalid name (redacted)');
          return false;
        }
        return !ports.isSynced(context, `to_pc/${file.name}`, file);
      });
      if (pending.length === 0) {
        await cleanupSynced(context, result.files);
        return;
      }

      const localPaths: string[] = [];
      const batch = pending.slice(0, 10);
      for (let index = 0; index < batch.length; index += 1) {
        const file = batch[index];
        if (!file || isStopped || !ports.isContextCurrent(context)) return;
        const localPath = await processFile(context, file, index);
        if (localPath) localPaths.push(localPath);
      }
      if (!isStopped && ports.isContextCurrent(context) && localPaths.length > 0) {
        ports.notifyDownloads(localPaths);
      }
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.error('Error in checkPhoneSync:', error);
    }
  };

  const executeSyncPath = async (path: string, metadata?: RemotePhoneFile): Promise<void> => {
    if (isStopped || !ports.isEnabled()) return;
    const context = ports.getContext();
    if (!context || !ports.isContextCurrent(context) || !path.startsWith('to_pc/')) return;
    const name = path.slice('to_pc/'.length);
    if (!isValidPhoneFileName(name)) {
      ports.warn('Phone sync: skipped sync path with invalid name (redacted)');
      return;
    }
    const file: RemotePhoneFile = {
      name,
      id: metadata?.id,
      updated_at: metadata?.updated_at,
    };
    if (!isValidRemotePhoneFile(file)) {
      ports.warn('Phone sync: skipped sync path with invalid metadata (redacted)');
      return;
    }
    if (ports.isSynced(context, path, file)) {
      await deleteRemote(context, path);
      return;
    }
    try {
      const localPath = await processFile(context, file, 0);
      if (localPath && !isStopped && ports.isContextCurrent(context)) {
        ports.notifyDownloads([localPath]);
      }
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.error('Error in syncPhoneFileByPath:', error);
    }
  };

  const processQueue = async (): Promise<void> => {
    while (!isStopped) {
      if (pendingSyncPaths.size > 0) {
        const entry = pendingSyncPaths.entries().next().value;
        if (entry) {
          const [nextPath, nextMeta] = entry;
          pendingSyncPaths.delete(nextPath);
          await executeSyncPath(nextPath, nextMeta);
        }
      } else if (pendingCheck) {
        pendingCheck = false;
        await executeCheck();
      } else {
        break;
      }
    }
  };

  const scheduleQueueWork = (): Promise<void> => {
    if (currentOperationPromise) {
      return currentOperationPromise;
    }
    currentOperationPromise = (async () => {
      try {
        await processQueue();
      } finally {
        currentOperationPromise = null;
      }
    })();
    return currentOperationPromise;
  };

  const check = async (): Promise<void> => {
    if (isStopped || !ports.isEnabled()) return;
    pendingCheck = true;
    await scheduleQueueWork();
  };

  const syncPath = async (path: string, file?: RemotePhoneFile): Promise<void> => {
    if (isStopped || !ports.isEnabled()) return;
    pendingSyncPaths.set(path, file);
    await scheduleQueueWork();
  };

  const stopRuntimeAndDrain = async (): Promise<void> => {
    isStopped = true;
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    pendingCheck = false;
    pendingSyncPaths.clear();

    const currentSub = subscription;
    subscription = null;
    if (currentSub !== null) {
      try {
        await ports.removeSubscription(currentSub);
      } catch (error: unknown) {
        if (error instanceof Error) {
          ports.error('Phone sync channel teardown failed:', error);
        }
      }
    }

    if (currentOperationPromise) {
      await currentOperationPromise;
    }
  };

  const enqueueLifecycleTransition = (transition: () => Promise<void>): Promise<void> => {
    const result = lifecycleTransition.then(transition, transition);
    lifecycleTransition = result.catch((error: unknown) => {
      if (error instanceof Error) {
        ports.error('Phone sync lifecycle transition failed:', error);
      }
    });
    return result;
  };

  const stopAndDrain = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    // Set synchronously so a concurrent setup() cannot queue a restart behind shutdown.
    shutdownRequested = true;
    shutdownPromise = enqueueLifecycleTransition(stopRuntimeAndDrain);
    return shutdownPromise;
  };

  const stop = (): void => {
    // A settings/runtime refresh is a temporary pause. setup() is serialized behind it.
    void enqueueLifecycleTransition(stopRuntimeAndDrain);
  };

  const setup = (): Promise<void> => {
    if (shutdownRequested) return shutdownPromise ?? lifecycleTransition;

    return enqueueLifecycleTransition(async () => {
      await stopRuntimeAndDrain();
      if (shutdownRequested) return;

      if (!ports.isEnabled()) {
        ports.log('Phone sync: disabled by settings');
        return;
      }
      const context = ports.getContext();
      if (!context) {
        ports.log('Phone sync: waiting for Supabase settings');
        return;
      }

      isStopped = false;
      subscription = ports.subscribe(
        context,
        (file) => {
          if (
            !isStopped &&
            ports.isContextCurrent(context) &&
            file &&
            typeof file.name === 'string' &&
            file.name.startsWith('to_pc/')
          ) {
            void syncPath(file.name, file);
          }
        },
        () => {
          if (!isStopped && ports.isContextCurrent(context)) void check();
        }
      );
      pollingInterval = setInterval(() => void check(), 15000);
      ports.log('Phone sync: realtime + 15s fallback initialized');
      void check();
    });
  };

  return { check, syncPath, setup, stop, stopAndDrain };
}

export function isValidRemotePhoneFile(file: any): boolean {
  if (!file || typeof file !== 'object') return false;
  if (typeof file.name !== 'string') return false;
  if (file.id !== undefined && file.id !== null && typeof file.id !== 'string') return false;
  if (
    file.updated_at !== undefined &&
    file.updated_at !== null &&
    typeof file.updated_at !== 'string'
  )
    return false;
  return true;
}

export function isValidPhoneFileName(name: any): name is string {
  if (typeof name !== 'string') return false;
  if (!name || name === '.keep' || name.startsWith('.')) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(name)) return false;
  if (name.length > 255) return false;

  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = name.slice(dotIndex).toLowerCase();
  const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
  return allowed.includes(ext);
}
