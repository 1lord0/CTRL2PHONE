import { IpcMain } from 'electron';
import type { DiagnosticsLogger } from './diagnosticsLogger';

const STORAGE_PAGE_SIZE = 1000;
const STORAGE_DELETE_BATCH_SIZE = 100;

interface StorageObjectLike {
  id?: string | null;
  name: string;
  metadata?: { size?: number } | null;
}

interface StorageResult<T> {
  data: T | null;
  error: any;
}

export class StorageBatchDeletionError extends Error {
  constructor(
    public readonly confirmedDeleted: number,
    public readonly cause: unknown
  ) {
    super(`Storage deletion failed after ${confirmedDeleted} confirmed deletions`);
    this.name = 'StorageBatchDeletionError';
  }
}

export async function collectStoragePages<T extends StorageObjectLike>(
  listPage: (offset: number, limit: number) => Promise<StorageResult<T[]>>,
  pageSize = STORAGE_PAGE_SIZE
): Promise<T[]> {
  if (pageSize <= 0) throw new RangeError('pageSize must be positive');

  const results: T[] = [];
  const seenFullPages = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await listPage(offset, pageSize);
    if (error) throw error;
    const page = data ?? [];
    if (page.length > pageSize) {
      throw new Error('Storage returned more rows than the requested page size');
    }
    if (page.length === 0) break;

    if (page.length === pageSize) {
      const signature = page.map((item) => item.id ?? item.name).join('\u0000');
      if (seenFullPages.has(signature)) {
        throw new Error('Storage pagination repeated a full page');
      }
      seenFullPages.add(signature);
    }

    results.push(...page);
    if (page.length < pageSize) break;
    const nextOffset = offset + page.length;
    if (nextOffset <= offset) throw new Error('Storage pagination did not advance');
    offset = nextOffset;
  }
  return results;
}

export async function removeStorageInBatches<T>(
  paths: string[],
  removeBatch: (batch: string[]) => Promise<StorageResult<T[]>>,
  batchSize = STORAGE_DELETE_BATCH_SIZE
): Promise<number> {
  if (batchSize <= 0) throw new RangeError('batchSize must be positive');

  let confirmedDeleted = 0;
  for (let start = 0; start < paths.length; start += batchSize) {
    const batch = paths.slice(start, start + batchSize);
    try {
      const { data, error } = await removeBatch(batch);
      if (error) throw error;
      const confirmedInBatch = data?.length ?? 0;
      if (confirmedInBatch > batch.length) {
        throw new Error('Storage returned an invalid deletion count');
      }
      confirmedDeleted += confirmedInBatch;
    } catch (error) {
      throw new StorageBatchDeletionError(confirmedDeleted, error);
    }
  }
  return confirmedDeleted;
}

export interface StorageIpcDeps {
  isMainSender(sender: any): boolean;
  supabaseRuntime: {
    getContext(): any;
    isCurrent(context: any): boolean;
  };
  getStoragePurgeInFlightGeneration(): number | null;
  setStoragePurgeInFlightGeneration(gen: number | null): void;
  diagnostics?: Pick<DiagnosticsLogger, 'action' | 'info' | 'error'>;
}

async function listBucketObjects(
  context: any,
  deps: StorageIpcDeps,
  path: string,
  operation: 'query' | 'purge'
): Promise<StorageObjectLike[]> {
  const storage = context.client.storage.from(context.bucket);
  return collectStoragePages(async (offset, limit) => {
    const result = await storage.list(path, { limit, offset, sortBy: { column: 'name' } });
    if (!deps.supabaseRuntime.isCurrent(context)) {
      throw new Error(`Supabase configuration changed during storage ${operation}`);
    }
    return result;
  });
}

export function registerStorageIpc(ipc: IpcMain, deps: StorageIpcDeps): () => void {
  ipc.handle('get-storage-usage', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const context = deps.supabaseRuntime.getContext();
    if (!context) {
      deps.diagnostics?.error(
        'supabase',
        'storage_usage_missing_settings',
        new Error('Supabase client not initialized'),
        undefined,
        'validation'
      );
      return { ok: false, error: 'Supabase client not initialized' };
    }
    if (deps.getStoragePurgeInFlightGeneration() === context.generation) {
      return { ok: false, error: 'Storage purge in progress' };
    }
    try {
      const files = await listBucketObjects(context, deps, '', 'query');

      let totalBytes = 0;
      for (const f of files) {
        if (f.name !== 'to_pc' && f.metadata && f.metadata.size) {
          totalBytes += f.metadata.size;
        }
      }

      const toPcFiles = await listBucketObjects(context, deps, 'to_pc', 'query');

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
      deps.diagnostics?.error('supabase', 'storage_usage_query_failed', err, {
        bucket: context.bucket,
      });
      return { ok: false, error: err.message };
    }
  });

  ipc.handle('purge-storage', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const context = deps.supabaseRuntime.getContext();
    if (!context) {
      deps.diagnostics?.error(
        'supabase',
        'storage_purge_missing_settings',
        new Error('Supabase client not initialized'),
        undefined,
        'validation'
      );
      return { ok: false, error: 'Supabase client not initialized' };
    }
    if (deps.getStoragePurgeInFlightGeneration() === context.generation) {
      return { ok: false, error: 'Storage purge already in progress' };
    }
    deps.setStoragePurgeInFlightGeneration(context.generation);
    deps.diagnostics?.action('supabase.storage_purge_requested', { bucket: context.bucket });

    try {
      const rootFiles = await listBucketObjects(context, deps, '', 'purge');

      const filesToDelete = new Set<string>();
      for (const f of rootFiles) {
        if (f.name !== 'to_pc' && f.name !== '.keep' && !f.name.startsWith('.')) {
          filesToDelete.add(f.name);
        }
      }

      const toPcFiles = await listBucketObjects(context, deps, 'to_pc', 'purge');

      for (const f of toPcFiles) {
        if (f.name !== '.keep' && !f.name.startsWith('.')) {
          filesToDelete.add(`to_pc/${f.name}`);
        }
      }

      const storage = context.client.storage.from(context.bucket);
      const deletedCount = await removeStorageInBatches([...filesToDelete], async (batch) => {
        const result = await storage.remove(batch);
        if (!deps.supabaseRuntime.isCurrent(context)) {
          throw new Error('Supabase configuration changed during storage purge');
        }
        return result;
      });

      deps.diagnostics?.info('supabase', 'storage_purge_succeeded', {
        bucket: context.bucket,
        deletedCount,
      });
      return { ok: true, deletedCount };
    } catch (err: any) {
      deps.diagnostics?.error('supabase', 'storage_purge_failed', err, {
        bucket: context.bucket,
        ...(err instanceof StorageBatchDeletionError
          ? { confirmedDeleted: err.confirmedDeleted }
          : {}),
      });
      return {
        ok: false,
        error: err.message,
        ...(err instanceof StorageBatchDeletionError ? { deletedCount: err.confirmedDeleted } : {}),
      };
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
