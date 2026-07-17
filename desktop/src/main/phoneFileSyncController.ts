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

export interface PhoneFileSyncPorts<
  Context extends PhoneFileSyncContext,
  Subscription
> {
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
  readonly setup: () => void;
  readonly stop: () => void;
}

export function createPhoneFileSyncController<
  Context extends PhoneFileSyncContext,
  Subscription
>(
  ports: PhoneFileSyncPorts<Context, Subscription>
): PhoneFileSyncController {
  let inFlightGeneration: number | null = null;
  let pollingInterval: NodeJS.Timeout | null = null;
  let subscription: Subscription | null = null;

  const deleteRemote = async (context: Context, path: string): Promise<void> => {
    if (!ports.isContextCurrent(context)) return;
    const error = await ports.deleteRemoteFile(context, path);
    if (error) ports.warn(`Phone sync: remote delete failed for ${path}:`, error);
  };

  const processFile = async (
    context: Context,
    file: RemotePhoneFile,
    batchIndex: number
  ): Promise<string | null> => {
    const path = `to_pc/${file.name}`;
    if (ports.isSynced(context, path, file)) {
      await deleteRemote(context, path);
      return null;
    }
    const localPath = await ports.downloadFile(context, file, batchIndex);
    if (!localPath || !ports.isContextCurrent(context)) return null;
    ports.markSynced(context, path, file);
    await deleteRemote(context, path);
    return localPath;
  };

  const cleanupSynced = async (
    context: Context,
    files: readonly RemotePhoneFile[]
  ): Promise<void> => {
    for (const file of files) {
      if (!ports.isContextCurrent(context)) return;
      if (!isValidPhoneFileName(file.name)) continue;
      const path = `to_pc/${file.name}`;
      if (ports.isSynced(context, path, file)) await deleteRemote(context, path);
    }
  };

  const check = async (): Promise<void> => {
    if (!ports.isEnabled()) return;
    const context = ports.getContext();
    if (!context || inFlightGeneration === context.generation) return;
    inFlightGeneration = context.generation;
    try {
      const result = await ports.listRemoteFiles(context);
      if (result.error) {
        ports.warn('Phone sync list error:', result.error);
        return;
      }
      if (!ports.isContextCurrent(context) || result.files.length === 0) return;
      const pending = result.files.filter(file => {
        if (!isValidPhoneFileName(file.name)) return false;
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
        if (!file || !ports.isContextCurrent(context)) return;
        const localPath = await processFile(context, file, index);
        if (localPath) localPaths.push(localPath);
      }
      if (ports.isContextCurrent(context) && localPaths.length > 0) {
        ports.notifyDownloads(localPaths);
      }
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.error('Error in checkPhoneSync:', error);
    } finally {
      if (inFlightGeneration === context.generation) inFlightGeneration = null;
    }
  };

  const syncPath = async (path: string, metadata?: RemotePhoneFile): Promise<void> => {
    const context = ports.getContext();
    if (!context || !path.startsWith('to_pc/')) return;
    const name = path.slice('to_pc/'.length);
    if (!isValidPhoneFileName(name)) return;
    const file: RemotePhoneFile = {
      name,
      id: metadata?.id,
      updated_at: metadata?.updated_at,
    };
    if (ports.isSynced(context, path, file)) {
      await deleteRemote(context, path);
      return;
    }
    if (inFlightGeneration === context.generation) return;
    inFlightGeneration = context.generation;
    try {
      const localPath = await processFile(context, file, 0);
      if (localPath && ports.isContextCurrent(context)) ports.notifyDownloads([localPath]);
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.error('Error in syncPhoneFileByPath:', error);
    } finally {
      if (inFlightGeneration === context.generation) inFlightGeneration = null;
    }
  };

  const stop = (): void => {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = null;
    const currentSubscription = subscription;
    subscription = null;
    if (currentSubscription === null) return;
    void ports.removeSubscription(currentSubscription).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      ports.error('Phone sync channel teardown failed:', error);
    });
  };

  const setup = (): void => {
    stop();
    if (!ports.isEnabled()) {
      ports.log('Phone sync: disabled by settings');
      return;
    }
    const context = ports.getContext();
    if (!context) {
      ports.log('Phone sync: waiting for Supabase settings');
      return;
    }
    subscription = ports.subscribe(
      context,
      file => {
        if (ports.isContextCurrent(context) && file.name.startsWith('to_pc/')) {
          void syncPath(file.name, file);
        }
      },
      () => {
        if (ports.isContextCurrent(context)) void check();
      }
    );
    pollingInterval = setInterval(() => void check(), 15000);
    ports.log('Phone sync: realtime + 15s fallback initialized');
    void check();
  };

  return { check, syncPath, setup, stop };
}

export function isValidPhoneFileName(name: string | null | undefined): name is string {
  return Boolean(name && name !== '.keep' && !name.startsWith('.'));
}
