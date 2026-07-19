export type SelectionDragAssetStore = {
  readonly currentPath: string | null;
  readonly generation: number;
  invalidate(): void;
  beginUpdate(): number;
  isCurrent(generation: number): boolean;
  commit(generation: number, filePath: string): boolean;
  detach(): string | null;
  delete(filePath: string | null): void;
  cleanupStaleFiles(maxAgeMs?: number): void;
};

export type SelectionDragAssetStoreOptions = {
  readonly getDirectory: () => string;
  readonly now?: () => number;
  readonly warn?: (message: string, error: unknown) => void;
};

export function createSelectionDragAssetStore(
  options: SelectionDragAssetStoreOptions
): SelectionDragAssetStore {
  let currentPath: string | null = null;
  let generation = 0;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? (() => undefined);

  const errorCode = (error: unknown): string | null => {
    if (typeof error !== 'object' || error === null || !('code' in error)) return null;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : null;
  };

  const deleteFile = (filePath: string | null): void => {
    if (!filePath) return;
    fs.unlink(filePath, (error) => {
      if (error && errorCode(error) !== 'ENOENT') {
        warn('Failed to delete temporary drag file', error);
      }
    });
  };

  return {
    get currentPath() {
      return currentPath;
    },
    get generation() {
      return generation;
    },
    invalidate() {
      generation += 1;
      const stalePath = currentPath;
      currentPath = null;
      deleteFile(stalePath);
    },
    beginUpdate() {
      generation += 1;
      return generation;
    },
    isCurrent(candidateGeneration) {
      return candidateGeneration === generation;
    },
    commit(candidateGeneration, filePath) {
      if (candidateGeneration !== generation) {
        deleteFile(filePath);
        return false;
      }
      const replacedPath = currentPath;
      currentPath = filePath;
      if (replacedPath !== filePath) {
        deleteFile(replacedPath);
      }
      return true;
    },
    detach() {
      generation += 1;
      const detachedPath = currentPath;
      currentPath = null;
      return detachedPath;
    },
    delete: deleteFile,
    cleanupStaleFiles(maxAgeMs = 10 * 60_000) {
      const oldestAllowed = now() - maxAgeMs;
      const directory = options.getDirectory();
      try {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (!entry.isFile() || !/^(drag-|capture-).*\.png$/i.test(entry.name)) continue;
          const filePath = path.join(directory, entry.name);
          try {
            if (fs.statSync(filePath).mtimeMs < oldestAllowed) {
              fs.unlinkSync(filePath);
            }
          } catch (error) {
            warn('Failed to inspect temporary drag file', error);
          }
        }
      } catch (error) {
        warn('Selection drag temp cleanup failed', error);
      }
    },
  };
}
import fs from 'fs';
import path from 'path';
