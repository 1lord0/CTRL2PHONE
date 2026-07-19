import { IpcMain } from 'electron';

export interface StorageIpcDeps {
  isMainSender(sender: any): boolean;
  supabaseRuntime: {
    getContext(): any;
    isCurrent(context: any): boolean;
  };
  getStoragePurgeInFlightGeneration(): number | null;
  setStoragePurgeInFlightGeneration(gen: number | null): void;
}

export function registerStorageIpc(ipc: IpcMain, deps: StorageIpcDeps): () => void {
  ipc.handle('get-storage-usage', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const context = deps.supabaseRuntime.getContext();
    if (!context) {
      return { ok: false, error: 'Supabase client not initialized' };
    }
    if (deps.getStoragePurgeInFlightGeneration() === context.generation) {
      return { ok: false, error: 'Storage purge in progress' };
    }
    try {
      const { data: files, error } = await context.client.storage.from(context.bucket).list('', {
        limit: 1000,
      });
      if (error) throw error;
      if (!deps.supabaseRuntime.isCurrent(context)) {
        throw new Error('Supabase configuration changed during storage query');
      }

      let totalBytes = 0;
      if (files) {
        for (const f of files) {
          if (f.name !== 'to_pc' && f.metadata && f.metadata.size) {
            totalBytes += f.metadata.size;
          }
        }
      }

      let toPcFiles: any[] = [];
      try {
        const { data: toPc, error: toPcError } = await context.client.storage
          .from(context.bucket)
          .list('to_pc', {
            limit: 1000,
          });
        if (!toPcError && toPc) toPcFiles = toPc;
      } catch {
        // ignore
      }

      if (!deps.supabaseRuntime.isCurrent(context)) {
        throw new Error('Supabase configuration changed during storage query');
      }

      for (const f of toPcFiles) {
        if (f.metadata && f.metadata.size) {
          totalBytes += f.metadata.size;
        }
      }

      const limitBytes = 1024 * 1024 * 1024; // 1 GB
      return {
        ok: true,
        usedBytes: totalBytes,
        limitBytes: limitBytes,
        usedPercentage: (totalBytes / limitBytes) * 100,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipc.handle('purge-storage', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const context = deps.supabaseRuntime.getContext();
    if (!context) {
      return { ok: false, error: 'Supabase client not initialized' };
    }
    if (deps.getStoragePurgeInFlightGeneration() === context.generation) {
      return { ok: false, error: 'Storage purge already in progress' };
    }
    deps.setStoragePurgeInFlightGeneration(context.generation);

    try {
      const { data: rootFiles, error: rootError } = await context.client.storage
        .from(context.bucket)
        .list('', {
          limit: 1000,
        });
      if (rootError) throw rootError;
      if (!deps.supabaseRuntime.isCurrent(context)) {
        throw new Error('Supabase configuration changed during storage purge');
      }

      const filesToDelete: string[] = [];
      if (rootFiles) {
        for (const f of rootFiles) {
          if (f.name !== 'to_pc' && f.name !== '.keep' && !f.name.startsWith('.')) {
            filesToDelete.push(f.name);
          }
        }
      }

      let toPcFiles: any[] = [];
      try {
        const { data: toPc, error: toPcError } = await context.client.storage
          .from(context.bucket)
          .list('to_pc', {
            limit: 1000,
          });
        if (!toPcError && toPc) toPcFiles = toPc;
      } catch {
        // ignore
      }

      if (!deps.supabaseRuntime.isCurrent(context)) {
        throw new Error('Supabase configuration changed during storage purge');
      }

      for (const f of toPcFiles) {
        if (f.name !== '.keep' && !f.name.startsWith('.')) {
          filesToDelete.push(`to_pc/${f.name}`);
        }
      }

      if (filesToDelete.length > 0) {
        const { error: removeError } = await context.client.storage
          .from(context.bucket)
          .remove(filesToDelete);
        if (removeError) throw removeError;
      }

      return { ok: true, deletedCount: filesToDelete.length };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      if (deps.getStoragePurgeInFlightGeneration() === context.generation) {
        deps.setStoragePurgeInFlightGeneration(null);
      }
    }
  });

  return () => {
    ipc.removeHandler('get-storage-usage');
    ipc.removeHandler('purge-storage');
  };
}
