import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface PhoneSyncNamespace {
  readonly url: string;
  readonly bucket: string;
}

export interface PhoneSyncMetadata {
  readonly id?: string | null;
  readonly updated_at?: string | null;
}

export interface PhoneSyncStatePorts {
  readonly resolvePath: () => string;
  readonly exists: (filePath: string) => boolean;
  readonly readText: (filePath: string) => string;
  readonly writeText: (filePath: string, content: string) => void;
  readonly warn: (message: string, error: Error) => void;
  readonly error: (message: string, error: Error) => void;
}

export interface PhoneSyncState {
  readonly load: () => void;
  readonly hasKey: (key: string) => boolean;
  readonly isSynced: (
    context: PhoneSyncNamespace,
    filePath: string,
    metadata?: PhoneSyncMetadata
  ) => boolean;
  readonly markSynced: (
    context: PhoneSyncNamespace,
    filePath: string,
    metadata?: PhoneSyncMetadata
  ) => void;
}

export function makePhoneSyncKey(
  context: PhoneSyncNamespace,
  filePath: string,
  metadata?: PhoneSyncMetadata
): string {
  const namespace = `${context.url}|${context.bucket}`;
  if (metadata?.id) return `${namespace}|id:${metadata.id}`;
  if (metadata?.updated_at) return `${namespace}|${filePath}@${metadata.updated_at}`;
  return `${namespace}|${filePath}`;
}

export function createPhoneSyncState(
  ports: PhoneSyncStatePorts,
  maxEntries = 2000
): PhoneSyncState {
  let syncedPaths = new Set<string>();

  const load = (): void => {
    try {
      const statePath = ports.resolvePath();
      if (!ports.exists(statePath)) {
        syncedPaths = new Set<string>();
        return;
      }
      const parsed: unknown = JSON.parse(ports.readText(statePath));
      if (!isRecord(parsed) || !Array.isArray(parsed.synced)) {
        syncedPaths = new Set<string>();
        return;
      }
      syncedPaths = new Set(parsed.synced.filter(isString));
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.warn('Phone sync state load failed, starting fresh:', error);
      syncedPaths = new Set<string>();
    }
  };

  const save = (): void => {
    try {
      const newestKeys = [...syncedPaths].slice(-maxEntries);
      syncedPaths = new Set(newestKeys);
      ports.writeText(ports.resolvePath(), JSON.stringify({ synced: newestKeys }, null, 2));
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.error('Phone sync state save failed:', error);
    }
  };

  const isSynced = (
    context: PhoneSyncNamespace,
    filePath: string,
    metadata?: PhoneSyncMetadata
  ): boolean => syncedPaths.has(makePhoneSyncKey(context, filePath, metadata));

  const markSynced = (
    context: PhoneSyncNamespace,
    filePath: string,
    metadata?: PhoneSyncMetadata
  ): void => {
    syncedPaths.add(makePhoneSyncKey(context, filePath, metadata));
    save();
  };

  return {
    load,
    hasKey: key => syncedPaths.has(key),
    isSynced,
    markSynced,
  };
}

export function createElectronPhoneSyncState(maxEntries = 2000): PhoneSyncState {
  return createPhoneSyncState(
    {
      resolvePath: () => path.join(app.getPath('userData'), 'phone-sync-state.json'),
      exists: filePath => fs.existsSync(filePath),
      readText: filePath => fs.readFileSync(filePath, 'utf8'),
      writeText: (filePath, content) => fs.writeFileSync(filePath, content, 'utf8'),
      warn: (message, error) => console.warn(message, error),
      error: (message, error) => console.error(message, error),
    },
    maxEntries
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
