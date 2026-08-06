import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhoneFileSyncPorts, RemotePhoneFile } from './phoneFileSyncController';
import type { StoreCreationResult } from './phoneDownloadAsset';
import type { SupabaseRuntime, SupabaseRuntimeContext } from './supabaseRuntime';

export type ElectronPhoneSyncContext = SupabaseRuntimeContext<SupabaseClient>;

export interface ElectronPhoneSyncSubscription {
  readonly client: SupabaseClient;
  readonly channel: ReturnType<SupabaseClient['channel']>;
}

interface ImageLike {
  isEmpty(): boolean;
}

export interface ElectronPhoneSyncAdapterDeps<Image extends ImageLike> {
  readonly isEnabled: () => boolean;
  readonly runtime: Pick<SupabaseRuntime<SupabaseClient>, 'getContext' | 'isCurrent'>;
  readonly state: {
    isSynced(context: ElectronPhoneSyncContext, path: string, file?: RemotePhoneFile): boolean;
    markSynced(context: ElectronPhoneSyncContext, path: string, file?: RemotePhoneFile): void;
  };
  readonly downloadStore: Promise<StoreCreationResult>;
  readonly createImageFromBuffer: (buffer: Buffer) => Image;
  readonly writeClipboardImage: (image: Image) => void;
  readonly guardLocalClipboard: (durationMs: number) => void;
  readonly notifyDownloads: (paths: string[]) => void;
  readonly log: (message: string) => void;
  readonly warn: (message: string, detail?: string) => void;
  readonly error: (message: string, error?: unknown) => void;
}

export interface ElectronPhoneSyncAdapter {
  readonly ports: PhoneFileSyncPorts<ElectronPhoneSyncContext, ElectronPhoneSyncSubscription>;
  readonly cleanupDownloads: () => Promise<void>;
}

export function createElectronPhoneSyncAdapter<Image extends ImageLike>(
  deps: ElectronPhoneSyncAdapterDeps<Image>
): ElectronPhoneSyncAdapter {
  const ports: PhoneFileSyncPorts<ElectronPhoneSyncContext, ElectronPhoneSyncSubscription> = {
    isEnabled: deps.isEnabled,
    getContext: deps.runtime.getContext,
    isContextCurrent: deps.runtime.isCurrent,
    isSynced: (context, filePath, file) => deps.state.isSynced(context, filePath, file),
    markSynced: (context, filePath, file) => deps.state.markSynced(context, filePath, file),
    listRemoteFiles: async (context) => {
      const { data, error } = await context.client.storage.from(context.bucket).list('to_pc', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });
      return {
        files: (data ?? []).map((file) => ({
          name: file.name,
          id: file.id,
          updated_at: file.updated_at,
        })),
        error: error?.message ?? null,
      };
    },
    downloadFile: async (context, file) => {
      const storeResult = await deps.downloadStore;
      if (!storeResult.ok || !storeResult.store) {
        deps.error(`Phone sync: store unavailable: ${storeResult.reason}`);
        return null;
      }

      const remotePath = `to_pc/${file.name}`;
      const { data: fileBlob, error } = await context.client.storage
        .from(context.bucket)
        .download(remotePath);
      if (error) {
        deps.error(`Phone sync: failed to download ${remotePath}`, error);
        return null;
      }
      const arrayBuffer = await fileBlob.arrayBuffer();
      if (!deps.runtime.isCurrent(context)) return null;
      const buffer = Buffer.from(arrayBuffer);
      const image = deps.createImageFromBuffer(buffer);
      if (image.isEmpty()) {
        deps.error('Phone sync: downloaded file is not a valid image (kept for retry)');
        return null;
      }

      deps.guardLocalClipboard(6000);
      deps.writeClipboardImage(image);

      const writeResult = await storeResult.store.write(file.name, buffer);
      if (!writeResult.ok) {
        deps.error(
          `Phone sync: failed to write download asset "${file.name}": ${writeResult.reason}`
        );
        return null;
      }
      return writeResult.localPath;
    },
    deleteRemoteFile: async (context, filePath) => {
      if (!deps.runtime.isCurrent(context)) return null;
      const { error } = await context.client.storage.from(context.bucket).remove([filePath]);
      return error?.message ?? null;
    },
    notifyDownloads: (paths) => deps.notifyDownloads([...paths]),
    subscribe: (context, onFile, onSubscribed) => {
      const channel = context.client
        .channel(`ctrl2phone-to-pc-${context.generation}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'storage',
            table: 'objects',
            filter: `bucket_id=eq.${context.bucket}`,
          },
          (payload) => {
            const row = payload.new as {
              name?: string;
              id?: string;
              updated_at?: string;
            };
            if (!row?.name) return;
            onFile({ name: row.name, id: row.id, updated_at: row.updated_at });
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onSubscribed();
        });
      return { client: context.client, channel };
    },
    removeSubscription: async (subscription) => {
      await subscription.client.removeChannel(subscription.channel);
    },
    log: deps.log,
    warn: deps.warn,
    error: deps.error,
  };

  return {
    ports,
    cleanupDownloads: async () => {
      try {
        const storeResult = await deps.downloadStore;
        if (storeResult.ok && storeResult.store) {
          await storeResult.store.cleanup();
        }
      } catch (error) {
        deps.error('Failed to cleanup phone sync downloads', error);
      }
    },
  };
}
