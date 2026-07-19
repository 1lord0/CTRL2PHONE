import { IPC_HANDLE_CHANNELS, IPC_ON_CHANNELS } from '../src/main/ipcChannels';
import { registerSettingsIpc } from '../src/main/registerSettingsIpc';
import { registerSelectionIpc } from '../src/main/registerSelectionIpc';
import { registerPanelIpc } from '../src/main/registerPanelIpc';
import { registerStorageIpc } from '../src/main/registerStorageIpc';
import { registerFileIpc } from '../src/main/registerFileIpc';
import { registerGeminiIpc } from '../src/main/registerGeminiIpc';

class MockIpcMain {
  handlers: Record<string, Function> = {};
  listeners: Record<string, Function[]> = {};

  handle(channel: string, callback: Function) {
    if (this.handlers[channel]) {
      throw new Error(`Duplicate handler registered for channel: ${channel}`);
    }
    this.handlers[channel] = callback;
  }

  on(channel: string, callback: Function) {
    if (!this.listeners[channel]) {
      this.listeners[channel] = [];
    }
    this.listeners[channel].push(callback);
  }

  removeHandler(channel: string) {
    delete this.handlers[channel];
  }

  removeListener(channel: string, callback: Function) {
    if (this.listeners[channel]) {
      this.listeners[channel] = this.listeners[channel].filter(cb => cb !== callback);
    }
  }
}

describe('IpcRegistrars', () => {
  let mockIpc: MockIpcMain;
  let disposables: (() => void)[] = [];

  beforeEach(() => {
    mockIpc = new MockIpcMain();
    disposables = [];
  });

  afterEach(() => {
    disposables.forEach(dispose => dispose());
  });

  it('registers all 29 handlers/listeners exactly once and disposes cleanly', () => {
    // Given mock adapters/dependencies
    const mockDeps: any = {
      settings: {},
      settingsStore: {
        update: jest.fn().mockReturnValue({}),
        save: jest.fn(),
      },
      mainWindowController: {
        getWindow: jest.fn(),
        applyCompactPillVisibility: jest.fn(),
        toggleSpotlight: jest.fn(),
        dismissSpotlight: jest.fn(),
        presentSpotlight: jest.fn(),
        resizeCompactPill: jest.fn(),
        syncCompactPillLayer: jest.fn(),
        clampPillBounds: jest.fn().mockReturnValue({ x: 0, y: 0, width: 100, height: 100 }),
        getPanelMode: jest.fn().mockReturnValue('compact'),
        getCompactPillSize: jest.fn().mockReturnValue({ width: 100, height: 100 }),
      },
      overlayWindowController: {
        getWindow: jest.fn(),
        hide: jest.fn(),
        invalidateLifecycle: jest.fn(),
      },
      selectionSession: {
        active: false,
        rect: null,
        isCurrent: jest.fn().mockReturnValue(true),
        setRect: jest.fn(),
        setAnnotated: jest.fn(),
        disableDrag: jest.fn(),
        snapshot: jest.fn(),
      },
      selectionDragAssetStore: {
        invalidate: jest.fn(),
        delete: jest.fn(),
        currentPath: 'mock-path',
        detach: jest.fn(),
      },
      supabaseRuntime: {
        invalidate: jest.fn(),
        getContext: jest.fn(),
        isCurrent: jest.fn(),
      },
      phoneSyncState: {
        load: jest.fn(),
      },
      notificationController: {
        show: jest.fn(),
      },
      clipboardSyncController: {
        sendToPhone: jest.fn(),
        setupPolling: jest.fn(),
        stopPolling: jest.fn(),
      },
      geminiWindowController: {
        open: jest.fn(),
      },
      phoneFileSyncController: {
        setup: jest.fn(),
        stop: jest.fn(),
      },
      // Actions
      executeSelectionAiAction: jest.fn(),
      executeSelectionPhoneAction: jest.fn(),
      executeSelectionOcrAction: jest.fn(),
      executeSelectionElectronDrag: jest.fn().mockReturnValue({ ok: true }),
      
      isShutdownStarted: () => false,
      getStoragePurgeInFlightGeneration: () => null,
      setStoragePurgeInFlightGeneration: jest.fn(),
      quitApplication: jest.fn(),
      startSelectionSession: jest.fn(),
      uploadFileToPhone: jest.fn(),
      deleteDownloadedFile: jest.fn(),
      resolveMainWindowDownload: jest.fn(),
      resolveApprovedDownloadedFile: jest.fn(),
      getStrings: jest.fn(),
      resolveLang: jest.fn(),
      getLocale: () => 'tr-TR',
      getPillMaxWidth: () => 720,
      downloadedPhoneFiles: [],
      writeTextToClipboardReliable: jest.fn(),
      shellOpenExternal: jest.fn(),
      isMainSender: jest.fn().mockReturnValue(true),
      isOverlaySender: jest.fn().mockReturnValue(true),
      isMainWindowSender: jest.fn().mockReturnValue(true),
    };

    // Register all IPC modules
    disposables.push(registerSettingsIpc(mockIpc, mockDeps));
    disposables.push(registerSelectionIpc(mockIpc, mockDeps));
    disposables.push(registerPanelIpc(mockIpc, mockDeps));
    disposables.push(registerStorageIpc(mockIpc, mockDeps));
    disposables.push(registerFileIpc(mockIpc, mockDeps));
    disposables.push(registerGeminiIpc(mockIpc, mockDeps));

    // Verify all handle channels are registered
    IPC_HANDLE_CHANNELS.forEach(channel => {
      expect(mockIpc.handlers[channel]).toBeDefined();
    });

    // Verify all on channels are registered
    IPC_ON_CHANNELS.forEach(channel => {
      expect(mockIpc.listeners[channel]).toBeDefined();
      expect(mockIpc.listeners[channel].length).toBe(1);
    });

    // Dispose all registrars
    disposables.forEach(dispose => dispose());
    disposables = [];

    // Verify they are completely cleaned up
    IPC_HANDLE_CHANNELS.forEach(channel => {
      expect(mockIpc.handlers[channel]).toBeUndefined();
    });

    IPC_ON_CHANNELS.forEach(channel => {
      expect(mockIpc.listeners[channel]).toEqual([]);
    });
  });

  it('rejects requests from unauthorized senders', async () => {
    // Create mock senders
    const mainWindowSender = { id: 'main-window' };
    const overlaySender = { id: 'overlay-window' };
    const spoofedSender = { id: 'spoofed-window' };

    const mockDeps: any = {
      settings: {},
      settingsStore: {
        update: jest.fn().mockReturnValue({}),
        save: jest.fn(),
      },
      mainWindowController: {
        getWindow: jest.fn(),
        applyCompactPillVisibility: jest.fn(),
        toggleSpotlight: jest.fn(),
        dismissSpotlight: jest.fn(),
        presentSpotlight: jest.fn(),
        resizeCompactPill: jest.fn(),
        syncCompactPillLayer: jest.fn(),
        clampPillBounds: jest.fn().mockReturnValue({ x: 0, y: 0, width: 100, height: 100 }),
        getPanelMode: jest.fn().mockReturnValue('compact'),
        getCompactPillSize: jest.fn().mockReturnValue({ width: 100, height: 100 }),
      },
      overlayWindowController: {
        getWindow: jest.fn(),
        hide: jest.fn(),
        invalidateLifecycle: jest.fn(),
      },
      selectionSession: {
        active: false,
        rect: null,
        isCurrent: jest.fn().mockReturnValue(true),
        setRect: jest.fn(),
        setAnnotated: jest.fn(),
        disableDrag: jest.fn(),
        snapshot: jest.fn(),
      },
      selectionDragAssetStore: {
        invalidate: jest.fn(),
        delete: jest.fn(),
        currentPath: 'mock-path',
        detach: jest.fn(),
      },
      supabaseRuntime: {
        invalidate: jest.fn(),
        getContext: jest.fn(),
        isCurrent: jest.fn(),
      },
      phoneSyncState: {
        load: jest.fn(),
      },
      notificationController: {
        show: jest.fn(),
      },
      clipboardSyncController: {
        sendToPhone: jest.fn(),
        setupPolling: jest.fn(),
        stopPolling: jest.fn(),
      },
      geminiWindowController: {
        open: jest.fn(),
      },
      phoneFileSyncController: {
        setup: jest.fn(),
        stop: jest.fn(),
      },
      executeSelectionAiAction: jest.fn(),
      executeSelectionPhoneAction: jest.fn(),
      executeSelectionOcrAction: jest.fn(),
      executeSelectionElectronDrag: jest.fn().mockReturnValue({ ok: true }),
      
      isShutdownStarted: () => false,
      getStoragePurgeInFlightGeneration: () => null,
      setStoragePurgeInFlightGeneration: jest.fn(),
      quitApplication: jest.fn(),
      startSelectionSession: jest.fn(),
      uploadFileToPhone: jest.fn(),
      deleteDownloadedFile: jest.fn(),
      resolveMainWindowDownload: jest.fn(),
      resolveApprovedDownloadedFile: jest.fn(),
      getStrings: jest.fn(),
      resolveLang: jest.fn(),
      getLocale: () => 'tr-TR',
      getPillMaxWidth: () => 720,
      downloadedPhoneFiles: [],
      writeTextToClipboardReliable: jest.fn(),
      shellOpenExternal: jest.fn(),
      getDownloadedPhoneFiles: () => [],
      // Sender validation functions
      isMainSender: (sender: any) => sender.id === 'main-window',
      isOverlaySender: (sender: any) => sender.id === 'overlay-window',
      isMainWindowSender: (sender: any) => sender.id === 'main-window',
    };

    // Register all IPC modules
    disposables.push(registerSettingsIpc(mockIpc, mockDeps));
    disposables.push(registerSelectionIpc(mockIpc, mockDeps));
    disposables.push(registerPanelIpc(mockIpc, mockDeps));
    disposables.push(registerStorageIpc(mockIpc, mockDeps));
    disposables.push(registerFileIpc(mockIpc, mockDeps));
    disposables.push(registerGeminiIpc(mockIpc, mockDeps));

    // Test main window channels reject non-main senders
    const mainWindowOnlyChannels = [
      'save-settings',
      'panel-interact-start',
      'panel-toggle',
      'panel-drag-by',
      'panel-dismiss',
      'panel-resize-compact',
      'panel-save-pinned',
      'send-clipboard',
      'generate-qr',
      'setup-rls',
      'open-gemini',
      'focus-gemini',
      'capture-now',
      'upload-file-to-phone',
      'delete-downloaded-file',
    ];

    for (const channel of mainWindowOnlyChannels) {
      const handler = mockIpc.handlers[channel];
      if (handler) {
        // Test with spoofed sender - should be rejected
        const spoofedEvent = { sender: spoofedSender };
        const result = await handler(spoofedEvent, {});
        if (IPC_HANDLE_CHANNELS.includes(channel as any)) {
          expect(result).toEqual({ ok: false, error: 'Unauthorized' });
        } else {
          expect(result).toBeFalsy();
        }
      }
    }

    // Test overlay channels reject non-overlay senders
    const overlayOnlyChannels = [
      'set-selection',
      'cancel-selection',
      'set-annotated',
      'confirm-selection-gemini',
      'confirm-selection-phone',
      'confirm-selection-ocr',
      'overlay-renderer-ready',
      'overlay-rendered',
    ];

    for (const channel of overlayOnlyChannels) {
      const handler = mockIpc.handlers[channel];
      if (handler) {
        // Test with main window sender - should be rejected
        const mainEvent = { sender: mainWindowSender };
        const result = await handler(mainEvent, {});
        if (IPC_HANDLE_CHANNELS.includes(channel as any)) {
          expect(result).toEqual({ ok: false, error: 'Unauthorized' });
        } else {
          expect(result).toBeFalsy();
        }
      }
    }

    // Clean up
    disposables.forEach(dispose => dispose());
    disposables = [];
  });
});
