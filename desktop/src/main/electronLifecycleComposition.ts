import {
  AppLifecycleController,
  AppLifecycleControllerPorts,
  createAppLifecycleController,
} from './appLifecycleController';

type ReplacedLifecyclePorts =
  | 'cleanupStaleSelectionDragFiles'
  | 'cleanupPhoneSyncDownloads'
  | 'setupPhoneSyncPolling'
  | 'setupClipboardPolling'
  | 'stopPhoneSyncPolling'
  | 'stopClipboardPolling'
  | 'invalidateSelectionDragAsset';

interface LifecycleApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  whenReady(): Promise<void>;
  isPackaged: boolean;
  on(event: string, callback: (...args: any[]) => void): void;
}

interface LifecycleScreen {
  getPrimaryDisplay(): any;
  on(event: string, callback: (...args: any[]) => void): void;
}

export type ElectronLifecycleCompositionDeps<
  AppType extends LifecycleApp,
  ScreenType extends LifecycleScreen,
> = Omit<AppLifecycleControllerPorts<AppType, ScreenType>, ReplacedLifecyclePorts> & {
  readonly selectionDragAssetStore: {
    cleanupStaleFiles(): void;
    invalidate(): void;
  };
  readonly phoneDownloadAdapter: {
    cleanupDownloads(): Promise<void>;
  };
  readonly phoneFileSyncController: {
    setup(): Promise<void>;
    stopAndDrain(): Promise<void>;
  };
  readonly clipboardSyncController: {
    setupPolling(): void;
    stopPolling(): Promise<void> | void;
  };
};

export interface ElectronLifecycleComposition {
  readonly controller: AppLifecycleController;
  readonly setupPhoneSyncPolling: () => Promise<void>;
  readonly setupClipboardPolling: () => void;
}

export function createElectronLifecycleComposition<
  AppType extends LifecycleApp,
  ScreenType extends LifecycleScreen,
>(deps: ElectronLifecycleCompositionDeps<AppType, ScreenType>): ElectronLifecycleComposition {
  const setupPhoneSyncPolling = async (): Promise<void> => {
    await deps.phoneFileSyncController.setup();
  };
  const setupClipboardPolling = (): void => {
    deps.clipboardSyncController.setupPolling();
  };

  const ports: AppLifecycleControllerPorts<AppType, ScreenType> = {
    app: deps.app,
    screen: deps.screen,
    settingsStore: deps.settingsStore,
    phoneSyncState: deps.phoneSyncState,
    mainWindowController: deps.mainWindowController,
    overlayWindowController: deps.overlayWindowController,
    keyListenerController: deps.keyListenerController,
    nativePillHudController: deps.nativePillHudController,
    cleanupStaleSelectionDragFiles: () => deps.selectionDragAssetStore.cleanupStaleFiles(),
    cleanupPhoneSyncDownloads: () => deps.phoneDownloadAdapter.cleanupDownloads(),
    setupPhoneSyncPolling,
    setupClipboardPolling,
    stopPhoneSyncPolling: () => deps.phoneFileSyncController.stopAndDrain(),
    stopClipboardPolling: () => deps.clipboardSyncController.stopPolling(),
    stopActionTaskMonitoring: deps.stopActionTaskMonitoring,
    externalCaptureDisplayCache: deps.externalCaptureDisplayCache,
    geminiWindowController: deps.geminiWindowController,
    autoUpdater: deps.autoUpdater,
    selectionSession: deps.selectionSession,
    invalidateSelectionDragAsset: () => deps.selectionDragAssetStore.invalidate(),
    notificationController: deps.notificationController,
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
    log: deps.log,
    warn: deps.warn,
    error: deps.error,
  };

  return {
    controller: createAppLifecycleController(ports),
    setupPhoneSyncPolling,
    setupClipboardPolling,
  };
}
