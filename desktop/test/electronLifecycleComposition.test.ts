import { createElectronLifecycleComposition } from '../src/main/electronLifecycleComposition';

describe('Electron lifecycle composition', () => {
  it('keeps setup and serialized shutdown wiring on the single lifecycle controller', async () => {
    const phoneSetup = jest.fn().mockResolvedValue(undefined);
    const phoneStop = jest.fn().mockResolvedValue(undefined);
    const clipboardSetup = jest.fn();
    const clipboardStop = jest.fn().mockResolvedValue(undefined);
    const cleanupDownloads = jest.fn().mockResolvedValue(undefined);
    const cleanupStaleFiles = jest.fn();
    const invalidateDragAsset = jest.fn();
    const app = {
      isQuitting: false,
      isPackaged: false,
      requestSingleInstanceLock: jest.fn(() => true),
      quit: jest.fn(),
      whenReady: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    const composition = createElectronLifecycleComposition({
      app,
      screen: { getPrimaryDisplay: jest.fn(), on: jest.fn() },
      settingsStore: {},
      phoneSyncState: {},
      mainWindowController: { destroy: jest.fn() },
      overlayWindowController: {
        invalidateLifecycle: jest.fn(),
        destroy: jest.fn(),
      },
      keyListenerController: { stop: jest.fn() },
      nativePillHudController: { start: jest.fn(), stop: jest.fn() },
      selectionDragAssetStore: {
        cleanupStaleFiles,
        invalidate: invalidateDragAsset,
      },
      phoneDownloadAdapter: { cleanupDownloads },
      phoneFileSyncController: { setup: phoneSetup, stopAndDrain: phoneStop },
      clipboardSyncController: { setupPolling: clipboardSetup, stopPolling: clipboardStop },
      externalCaptureDisplayCache: { resolve: jest.fn(), invalidate: jest.fn() },
      geminiWindowController: { destroy: jest.fn() },
      autoUpdater: {},
      selectionSession: { shutdown: jest.fn() },
      notificationController: { shutdown: jest.fn() },
      setTimeout: jest.fn(),
      clearTimeout: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });

    await composition.setupPhoneSyncPolling();
    composition.setupClipboardPolling();
    await expect(composition.controller.beginShutdown()).resolves.toBe(true);

    expect(phoneSetup).toHaveBeenCalledTimes(1);
    expect(clipboardSetup).toHaveBeenCalledTimes(1);
    expect(phoneStop).toHaveBeenCalledTimes(1);
    expect(clipboardStop).toHaveBeenCalledTimes(1);
    expect(cleanupDownloads).toHaveBeenCalledTimes(1);
    expect(phoneStop.mock.invocationCallOrder[0]).toBeLessThan(
      clipboardStop.mock.invocationCallOrder[0]
    );
    expect(clipboardStop.mock.invocationCallOrder[0]).toBeLessThan(
      cleanupDownloads.mock.invocationCallOrder[0]
    );
    expect(invalidateDragAsset).toHaveBeenCalledTimes(1);
    expect(app.isQuitting).toBe(true);
  });
});
