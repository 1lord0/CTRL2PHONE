import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSelectionDragAssetStore } from '../src/main/selectionDragAssetStore';

describe('selection drag asset store', () => {
  const tempDirectories: string[] = [];

  function createFixture(now = 1_000_000) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl2phone-drag-test-'));
    tempDirectories.push(directory);
    return {
      directory,
      store: createSelectionDragAssetStore({ getDirectory: () => directory, now: () => now }),
    };
  }

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      for (const entry of fs.readdirSync(directory)) {
        fs.unlinkSync(path.join(directory, entry));
      }
      fs.rmdirSync(directory);
    }
  });

  it('accepts only the latest generated drag asset', () => {
    // Given two overlapping drag image updates
    const { store } = createFixture();
    const staleGeneration = store.beginUpdate();
    const currentGeneration = store.beginUpdate();

    // When both updates try to commit their files
    const staleAccepted = store.commit(staleGeneration, 'stale.png');
    const currentAccepted = store.commit(currentGeneration, 'current.png');

    // Then only the latest generation becomes the active drag asset
    expect(staleAccepted).toBe(false);
    expect(currentAccepted).toBe(true);
    expect(store.currentPath).toBe('current.png');
  });

  it('invalidates and deletes the active temporary file', () => {
    // Given a committed temporary drag file
    const { directory, store } = createFixture();
    const filePath = path.join(directory, 'drag-current.png');
    fs.writeFileSync(filePath, 'image');
    store.commit(store.beginUpdate(), filePath);

    // When the asset is invalidated
    store.invalidate();

    // Then it is detached immediately and deleted asynchronously
    expect(store.currentPath).toBeNull();
    expect(store.isCurrent(1)).toBe(false);
    return new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        try {
          expect(fs.existsSync(filePath)).toBe(false);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it('detaches a drag file without deleting it during native handoff', () => {
    // Given a committed drag file needed by the native drag operation
    const { directory, store } = createFixture();
    const filePath = path.join(directory, 'drag-handoff.png');
    fs.writeFileSync(filePath, 'image');
    store.commit(store.beginUpdate(), filePath);

    // When ownership is detached for the native drag handoff
    const detachedPath = store.detach();

    // Then the file remains available while future updates are invalidated
    expect(detachedPath).toBe(filePath);
    expect(store.currentPath).toBeNull();
    expect(fs.existsSync(filePath)).toBe(true);
    expect(store.isCurrent(1)).toBe(false);
  });

  it('removes only stale screenshot drag files from its directory', () => {
    // Given stale and recent managed files plus an unrelated file
    const { directory, store } = createFixture();
    const stalePath = path.join(directory, 'drag-stale.png');
    const recentPath = path.join(directory, 'capture-recent.png');
    const unrelatedPath = path.join(directory, 'notes.txt');
    fs.writeFileSync(stalePath, 'stale');
    fs.writeFileSync(recentPath, 'recent');
    fs.writeFileSync(unrelatedPath, 'notes');
    fs.utimesSync(stalePath, new Date(0), new Date(0));

    // When stale asset cleanup runs
    store.cleanupStaleFiles(10 * 60_000);

    // Then only the stale managed image is removed
    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.existsSync(recentPath)).toBe(true);
    expect(fs.existsSync(unrelatedPath)).toBe(true);
  });
});
