export interface AppLifecycleControllerPorts<AppType, ScreenType> {
  app: AppType;
  screen: ScreenType;
  settingsStore: any;
  phoneSyncState: any;
  mainWindowController: any;
  overlayWindowController: any;
  keyListenerController: any;
  nativePillHudController: {
    start(): void;
    stop(): void;
  };
  cleanupStaleSelectionDragFiles(): void;
  cleanupPhoneSyncDownloads?(): void;
  setupPhoneSyncPolling(): void;
  setupClipboardPolling(): void;
  stopPhoneSyncPolling(): void;
  stopClipboardPolling(): void;
  externalCaptureDisplayCache: {
    resolve(display: any): Promise<any>;
    invalidate(): void;
  };
  geminiWindowController: any;
  autoUpdater: any;
  selectionSession: {
    shutdown(): void;
  };
  invalidateSelectionDragAsset(): void;
  notificationController: {
    shutdown(): void;
  };

  // Timer functions
  setTimeout(callback: () => void, ms: number): any;
  clearTimeout(timer: any): void;

  log(message: string): void;
  warn(message: string, error?: any): void;
  error(message: string, error?: any): void;
}

export interface AppLifecycleController {
  start(): void;
  beginShutdown(): boolean;
  isShutdownStarted(): boolean;
}

export function createAppLifecycleController<
  AppType extends {
    requestSingleInstanceLock(): boolean;
    quit(): void;
    whenReady(): Promise<void>;
    isPackaged: boolean;
    on(event: string, callback: (...args: any[]) => void): void;
  },
  ScreenType extends {
    getPrimaryDisplay(): any;
    on(event: string, callback: (...args: any[]) => void): void;
  },
>(ports: AppLifecycleControllerPorts<AppType, ScreenType>): AppLifecycleController {
  let shutdownStarted = false;
  let transientTimer: any = null;
  let geminiPrewarmTimer: any = null;

  const self: AppLifecycleController = {
    start() {
      const gotTheLock = ports.app.requestSingleInstanceLock();
      if (!gotTheLock) {
        ports.app.quit();
        return;
      }

      ports.app.on('second-instance', () => {
        if (!shutdownStarted) {
          const mainWindow = ports.mainWindowController.getWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        }
      });

      ports.app.whenReady().then(() => {
        ports.settingsStore.load();
        ports.phoneSyncState.load();

        ports.mainWindowController.init();
        ports.nativePillHudController.start();
        ports.overlayWindowController.ensureWindow();

        ports.externalCaptureDisplayCache
          .resolve(ports.screen.getPrimaryDisplay())
          .catch((error) => ports.warn('Capture display prewarm failed:', error));

        ports.screen.on('display-added', ports.externalCaptureDisplayCache.invalidate);
        ports.screen.on('display-removed', ports.externalCaptureDisplayCache.invalidate);
        ports.screen.on('display-metrics-changed', ports.externalCaptureDisplayCache.invalidate);

        try {
          ports.keyListenerController.start();
        } catch (err) {
          ports.error('Klavye dinleyici başlatılamadı:', err);
        }

        ports.cleanupStaleSelectionDragFiles();
        ports.cleanupPhoneSyncDownloads?.();
        ports.setupPhoneSyncPolling();
        ports.setupClipboardPolling();

        geminiPrewarmTimer = ports.setTimeout(() => {
          if (!shutdownStarted) {
            ports.geminiWindowController
              .ensureLoaded()
              .catch((e: any) => ports.error('Gemini ön-yükleme hatası:', e));
          }
        }, 5000);

        const isPacked = ports.app.isPackaged;
        const forceDevUpdate = false;

        if (isPacked || forceDevUpdate) {
          ports.autoUpdater
            .checkForUpdatesAndNotify()
            .catch((e: any) => ports.error('Güncelleme kontrolü başarısız:', e));
        } else {
          ports.log(
            'Skip checkForUpdates because application is not packed and dev update config is not forced'
          );
        }

        ports.app.on('activate', () => {
          // If all windows are closed, re-create main window (or no-op)
          // Under our structure, main window is handled by mainWindowController.
          const mainWindow = ports.mainWindowController.getWindow();
          if (!mainWindow || mainWindow.isDestroyed()) {
            ports.mainWindowController.init();
          }
        });
      });

      ports.app.on('before-quit', () => {
        if (self.beginShutdown()) {
          // Let the asynchronous teardown process complete
        }
      });

      ports.app.on('will-quit', () => {
        // Teardown is fully handled in beginShutdown
      });

      ports.app.on('window-all-closed', () => {
        // Darwin (macOS) usually stays active, but Windows/Linux quits on close.
        // We run on Windows.
        ports.app.quit();
      });
    },

    beginShutdown() {
      if (shutdownStarted) return false;
      shutdownStarted = true;
      (ports.app as any).isQuitting = true;

      ports.selectionSession.shutdown();
      ports.invalidateSelectionDragAsset();
      ports.cleanupPhoneSyncDownloads?.();

      if (transientTimer !== null) {
        ports.clearTimeout(transientTimer);
        transientTimer = null;
      }
      if (geminiPrewarmTimer !== null) {
        ports.clearTimeout(geminiPrewarmTimer);
        geminiPrewarmTimer = null;
      }

      ports.notificationController.shutdown();
      ports.overlayWindowController.invalidateLifecycle();
      ports.nativePillHudController.stop();
      ports.keyListenerController.stop();
      ports.stopPhoneSyncPolling();
      ports.stopClipboardPolling();

      // Cleanup controllers
      ports.mainWindowController.destroy();
      ports.overlayWindowController.destroy();
      ports.geminiWindowController.destroy();

      return true;
    },

    isShutdownStarted() {
      return shutdownStarted;
    },
  };

  return self;
}
