import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  createPhoneFileSyncController,
} from '../src/main/phoneFileSyncController';
import { createPhoneDownloadAssetStore } from '../src/main/phoneDownloadAsset';
import { createAppLifecycleController } from '../src/main/appLifecycleController';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('phone sync and shutdown integration', () => {
  let parentDir: string;

  beforeEach(async () => {
    parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-int-parent-'));
  });

  afterEach(async () => {
    if (parentDir) {
      await fs.rm(parentDir, { recursive: true, force: true });
    }
  });

  it('serializes poll and realtime event overlap without duplicating downloads', async () => {
    const downloaded: string[] = [];
    const deleted: string[] = [];
    const context = { generation: 1, url: 'http://test', bucket: 'test' };
    const syncedSet = new Set<string>();

    const downloadDeferred = createDeferred<string>();

    const controller = createPhoneFileSyncController({
      isEnabled: () => true,
      getContext: () => context,
      isContextCurrent: () => true,
      isSynced: (_ctx, p) => syncedSet.has(p),
      markSynced: (_ctx, p) => syncedSet.add(p),
      listRemoteFiles: async () => ({
        files: [{ name: 'overlap.png', id: '1' }],
        error: null,
      }),
      downloadFile: async (_ctx, file) => {
        downloaded.push(file.name);
        return await downloadDeferred.promise;
      },
      deleteRemoteFile: async (_ctx, p) => {
        deleted.push(p);
        return null;
      },
      notifyDownloads: () => {},
      subscribe: () => 'sub',
      removeSubscription: async () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
    });

    const checkPromise = controller.check();
    const syncPromise = controller.syncPath('to_pc/overlap.png');

    downloadDeferred.resolve('/tmp/overlap.png');
    await checkPromise;
    await syncPromise;

    expect(downloaded).toEqual(['overlap.png']);
    expect(deleted.length).toBeGreaterThanOrEqual(1);
    expect(deleted[0]).toBe('to_pc/overlap.png');
  });

  it('does not install a replacement subscription until an in-flight download drains', async () => {
    const downloadDeferred = createDeferred<string | null>();
    const context = { generation: 1, url: 'http://test', bucket: 'test' };
    let subscriptionCount = 0;

    const controller = createPhoneFileSyncController({
      isEnabled: () => true,
      getContext: () => context,
      isContextCurrent: () => true,
      isSynced: () => false,
      markSynced: () => {},
      listRemoteFiles: async () => ({ files: [], error: null }),
      downloadFile: async () => await downloadDeferred.promise,
      deleteRemoteFile: async () => null,
      notifyDownloads: () => {},
      subscribe: () => {
        subscriptionCount += 1;
        return `sub-${subscriptionCount}`;
      },
      removeSubscription: async () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
    });

    const syncPromise = controller.syncPath('to_pc/photo.png');
    const setupPromise = controller.setup();

    await Promise.resolve();
    expect(subscriptionCount).toBe(0);

    downloadDeferred.resolve('/tmp/photo.png');
    await syncPromise;
    await setupPromise;

    expect(subscriptionCount).toBe(1);
    await controller.stopAndDrain();
  });

  it('serializes rapid setup calls and leaves only the latest subscription active', async () => {
    const context = { generation: 1, url: 'http://test', bucket: 'test' };
    const activeSubscriptions = new Set<string>();
    let nextSubscription = 0;

    const controller = createPhoneFileSyncController({
      isEnabled: () => true,
      getContext: () => context,
      isContextCurrent: () => true,
      isSynced: () => false,
      markSynced: () => {},
      listRemoteFiles: async () => ({ files: [], error: null }),
      downloadFile: async () => null,
      deleteRemoteFile: async () => null,
      notifyDownloads: () => {},
      subscribe: () => {
        const subscription = `sub-${++nextSubscription}`;
        activeSubscriptions.add(subscription);
        return subscription;
      },
      removeSubscription: async subscription => {
        activeSubscriptions.delete(subscription);
      },
      log: () => {},
      warn: () => {},
      error: () => {},
    });

    const firstSetup = controller.setup();
    const secondSetup = controller.setup();
    await Promise.all([firstSetup, secondSetup]);

    expect(nextSubscription).toBe(2);
    expect([...activeSubscriptions]).toEqual(['sub-2']);

    await controller.stopAndDrain();
    expect(activeSubscriptions.size).toBe(0);
  });

  it('does not allow setup to reactivate synchronization after shutdown starts', async () => {
    const context = { generation: 1, url: 'http://test', bucket: 'test' };
    const removalDeferred = createDeferred<void>();
    let subscriptionCount = 0;
    let removalCount = 0;

    const controller = createPhoneFileSyncController({
      isEnabled: () => true,
      getContext: () => context,
      isContextCurrent: () => true,
      isSynced: () => false,
      markSynced: () => {},
      listRemoteFiles: async () => ({ files: [], error: null }),
      downloadFile: async () => null,
      deleteRemoteFile: async () => null,
      notifyDownloads: () => {},
      subscribe: () => `sub-${++subscriptionCount}`,
      removeSubscription: async () => {
        removalCount += 1;
        await removalDeferred.promise;
      },
      log: () => {},
      warn: () => {},
      error: () => {},
    });

    await controller.setup();
    const replacementSetup = controller.setup();
    const shutdown = controller.stopAndDrain();

    await Promise.resolve();
    expect(removalCount).toBe(1);
    removalDeferred.resolve();

    await replacementSetup;
    await shutdown;
    await controller.setup();

    expect(subscriptionCount).toBe(1);
  });

  it('drains in-flight downloads before lifecycle shutdown completes and cleans store', async () => {
    const downloadDeferred = createDeferred<string | null>();
    let cleanupCompleted = false;
    const shutdownOrder: string[] = [];

    const storeResult = await createPhoneDownloadAssetStore(parentDir);
    if (!storeResult.ok || !storeResult.store) throw new Error('Store creation failed');
    const store = storeResult.store;

    const context = { generation: 1, url: 'http://test', bucket: 'test' };
    const controller = createPhoneFileSyncController({
      isEnabled: () => true,
      getContext: () => context,
      isContextCurrent: () => true,
      isSynced: () => false,
      markSynced: () => {},
      listRemoteFiles: async () => ({ files: [], error: null }),
      downloadFile: async () => await downloadDeferred.promise,
      deleteRemoteFile: async () => null,
      notifyDownloads: () => {},
      subscribe: () => 'sub',
      removeSubscription: async () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
    });

    const lifecycle = createAppLifecycleController({
      app: { requestSingleInstanceLock: () => true, quit: () => {}, whenReady: async () => {}, isPackaged: false, on: () => {} } as any,
      screen: { getPrimaryDisplay: () => ({ id: 1 }), on: () => {} } as any,
      settingsStore: { load: () => {} } as any,
      phoneSyncState: { load: () => {} } as any,
      mainWindowController: { init: () => {}, destroy: () => shutdownOrder.push('destroy') } as any,
      overlayWindowController: { ensureWindow: () => {}, invalidateLifecycle: () => {}, destroy: () => {} } as any,
      keyListenerController: { start: () => {}, stop: () => {} } as any,
      nativePillHudController: { start: () => {}, stop: () => {} } as any,
      cleanupStaleSelectionDragFiles: () => {},
      cleanupPhoneSyncDownloads: async () => {
        await store.cleanup();
        cleanupCompleted = true;
        shutdownOrder.push('cleanup');
      },
      setupPhoneSyncPolling: () => {},
      setupClipboardPolling: () => {},
      stopPhoneSyncPolling: async () => {
        await controller.stopAndDrain();
        shutdownOrder.push('drain');
      },
      stopClipboardPolling: () => {},
      stopActionTaskMonitoring: () => {},
      externalCaptureDisplayCache: { resolve: async () => {}, invalidate: () => {} } as any,
      geminiWindowController: { ensureLoaded: async () => {}, destroy: () => {} } as any,
      autoUpdater: { checkForUpdatesAndNotify: async () => {} } as any,
      selectionSession: { shutdown: () => {} } as any,
      invalidateSelectionDragAsset: () => {},
      notificationController: { shutdown: () => {} } as any,
      setTimeout: () => 1,
      clearTimeout: () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
    });

    const syncPromise = controller.syncPath('to_pc/photo.jpg');
    const shutdownPromise = lifecycle.beginShutdown();

    expect(cleanupCompleted).toBe(false);

    downloadDeferred.resolve('/tmp/photo.jpg');

    await syncPromise;
    const shutdownResult = await shutdownPromise;

    expect(shutdownResult).toBe(true);
    expect(cleanupCompleted).toBe(true);
    expect(shutdownOrder.slice(0, 3)).toEqual(['drain', 'cleanup', 'destroy']);
    await expect(fs.lstat(store.rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns the same completion promise on repeated beginShutdown calls', async () => {
    const lifecycle = createAppLifecycleController({
      app: { requestSingleInstanceLock: () => true, quit: () => {}, whenReady: async () => {}, isPackaged: false, on: () => {} } as any,
      screen: { getPrimaryDisplay: () => ({ id: 1 }), on: () => {} } as any,
      settingsStore: { load: () => {} } as any,
      phoneSyncState: { load: () => {} } as any,
      mainWindowController: { init: () => {}, destroy: () => {} } as any,
      overlayWindowController: { ensureWindow: () => {}, invalidateLifecycle: () => {}, destroy: () => {} } as any,
      keyListenerController: { start: () => {}, stop: () => {} } as any,
      nativePillHudController: { start: () => {}, stop: () => {} } as any,
      cleanupStaleSelectionDragFiles: () => {},
      setupPhoneSyncPolling: () => {},
      setupClipboardPolling: () => {},
      stopPhoneSyncPolling: async () => {},
      stopClipboardPolling: async () => {},
      stopActionTaskMonitoring: async () => {},
      externalCaptureDisplayCache: { resolve: async () => {}, invalidate: () => {} } as any,
      geminiWindowController: { ensureLoaded: async () => {}, destroy: () => {} } as any,
      autoUpdater: { checkForUpdatesAndNotify: async () => {} } as any,
      selectionSession: { shutdown: () => {} } as any,
      invalidateSelectionDragAsset: () => {},
      notificationController: { shutdown: () => {} } as any,
      setTimeout: () => 1,
      clearTimeout: () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
    });

    const p1 = lifecycle.beginShutdown();
    const p2 = lifecycle.beginShutdown();

    expect(p1).toBe(p2);
    expect(await p1).toBe(true);
    expect(await p2).toBe(true);

    const p3 = lifecycle.beginShutdown();
    expect(p3).toBe(p1);
    expect(await p3).toBe(true);
  });

  it('prevents a junction from redirecting writes or cleanup during store lifecycle', async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrl2phone-junc-target-'));
    const legacyJunction = path.join(parentDir, 'ctrl2phone');
    await fs.symlink(targetDir, legacyJunction, process.platform === 'win32' ? 'junction' : 'dir');

    try {
      const storeResult = await createPhoneDownloadAssetStore(parentDir);
      if (!storeResult.ok || !storeResult.store) throw new Error('Store creation failed');

      const writeResult = await storeResult.store.write('test.png', Buffer.from('test-data'));
      expect(writeResult.ok).toBe(true);

      expect(await fs.readdir(targetDir)).toEqual([]);

      await storeResult.store.cleanup();
      expect(await fs.readdir(targetDir)).toEqual([]);
    } finally {
      await fs.unlink(legacyJunction);
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});
