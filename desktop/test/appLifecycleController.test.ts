import {
  createAppLifecycleController,
  type AppLifecycleControllerPorts,
} from '../src/main/appLifecycleController';

describe('AppLifecycleController', () => {
  let settingsLoaded = false;
  let syncStateLoaded = false;
  let mainWindowCreated = false;
  let overlayPrewarmed = false;
  let displayCachePrewarmed = false;
  let keyListenerStarted = false;
  let keyListenerStopped = false;
  let nativePillHudStarted = false;
  let nativePillHudStartCount = 0;
  let nativePillHudStopCount = 0;
  let startupOrder: string[] = [];
  let cleanupStaleFilesCalled = false;
  let setupPhoneSyncCalled = false;
  let setupClipboardCalled = false;
  let stopPhoneSyncCalled = false;
  let stopClipboardCalled = false;
  let geminiPrewarmed = false;
  let checkUpdatesCalled = false;
  let appQuitted = false;
  let displayAddedRegistered = false;

  let whenReadyPromise: Promise<void> = Promise.resolve();
  let gotLock = true;
  let timersCreated: any[] = [];
  let screenListeners: Record<string, Function> = {};

  const ports: AppLifecycleControllerPorts<any, any> = {
    app: {
      requestSingleInstanceLock: () => gotLock,
      quit: () => { appQuitted = true; },
      whenReady: () => whenReadyPromise,
      isPackaged: false,
      on: jest.fn(),
    } as any,
    screen: {
      getPrimaryDisplay: () => ({ id: 1 }),
      on: (event: string, callback: Function) => {
        screenListeners[event] = callback;
        displayAddedRegistered = true;
      },
    } as any,
    settingsStore: {
      load: () => { settingsLoaded = true; },
    } as any,
    phoneSyncState: {
      load: () => { syncStateLoaded = true; },
    } as any,
    mainWindowController: {
      init: () => {
        mainWindowCreated = true;
        startupOrder.push('main-window-init');
      },
      destroy: jest.fn(),
    } as any,
    overlayWindowController: {
      ensureWindow: () => { overlayPrewarmed = true; return {} as any; },
      invalidateLifecycle: jest.fn(),
      destroy: jest.fn(),
    } as any,
    keyListenerController: {
      start: () => { keyListenerStarted = true; },
      stop: () => { keyListenerStopped = true; },
    } as any,
    cleanupStaleSelectionDragFiles: () => { cleanupStaleFilesCalled = true; },
    setupPhoneSyncPolling: () => { setupPhoneSyncCalled = true; },
    setupClipboardPolling: () => { setupClipboardCalled = true; },
    stopPhoneSyncPolling: () => { stopPhoneSyncCalled = true; },
    stopClipboardPolling: () => { stopClipboardCalled = true; },
    externalCaptureDisplayCache: {
      resolve: async () => { displayCachePrewarmed = true; },
      invalidate: jest.fn(),
    } as any,
    geminiWindowController: {
      ensureLoaded: async () => { geminiPrewarmed = true; },
      destroy: jest.fn(),
    } as any,
    autoUpdater: {
      checkForUpdatesAndNotify: async () => { checkUpdatesCalled = true; },
      on: jest.fn(),
    } as any,
    selectionSession: {
      shutdown: jest.fn(),
    } as any,
    invalidateSelectionDragAsset: jest.fn(),
    notificationController: {
      shutdown: jest.fn(),
    } as any,
    nativePillHudController: {
      start: () => {
        nativePillHudStarted = true;
        nativePillHudStartCount += 1;
        startupOrder.push('native-pill-start');
      },
      stop: () => {
        nativePillHudStopCount += 1;
      },
    } as any,
    
    // Timer mock
    setTimeout: (cb: any, ms: number) => {
      timersCreated.push({ cb, ms });
      return 123;
    },
    clearTimeout: jest.fn(),
    
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeEach(() => {
    settingsLoaded = false;
    syncStateLoaded = false;
    mainWindowCreated = false;
    overlayPrewarmed = false;
    displayCachePrewarmed = false;
    keyListenerStarted = false;
    keyListenerStopped = false;
    nativePillHudStarted = false;
    nativePillHudStartCount = 0;
    nativePillHudStopCount = 0;
    startupOrder = [];
    cleanupStaleFilesCalled = false;
    setupPhoneSyncCalled = false;
    setupClipboardCalled = false;
    stopPhoneSyncCalled = false;
    stopClipboardCalled = false;
    geminiPrewarmed = false;
    checkUpdatesCalled = false;
    appQuitted = false;
    displayAddedRegistered = false;
    whenReadyPromise = Promise.resolve();
    gotLock = true;
    timersCreated = [];
    screenListeners = {};
  });

  it('runs initialization steps on startup when ready resolves', async () => {
    const controller = createAppLifecycleController(ports);
    controller.start();

    // let ready promises resolve
    await whenReadyPromise;
    await new Promise(resolve => setImmediate(resolve));

    expect(settingsLoaded).toBe(true);
    expect(syncStateLoaded).toBe(true);
    expect(mainWindowCreated).toBe(true);
    expect(nativePillHudStarted).toBe(true);
    expect(nativePillHudStartCount).toBe(1);
    expect(startupOrder).toEqual(['main-window-init', 'native-pill-start']);
    expect(overlayPrewarmed).toBe(true);
    expect(displayCachePrewarmed).toBe(true);
    expect(displayAddedRegistered).toBe(true);
    expect(keyListenerStarted).toBe(true);
    expect(cleanupStaleFilesCalled).toBe(true);
    expect(setupPhoneSyncCalled).toBe(true);
    expect(setupClipboardCalled).toBe(true);

    // Verify 5s delayed Gemini prewarm timer
    expect(timersCreated.length).toBe(1);
    expect(timersCreated[0].ms).toBe(5000);
    
    // Trigger Gemini prewarm
    await timersCreated[0].cb();
    expect(geminiPrewarmed).toBe(true);
  });

  it('quits immediately if single instance lock is not acquired', () => {
    gotLock = false;
    const controller = createAppLifecycleController(ports);
    controller.start();

    expect(appQuitted).toBe(true);
    expect(mainWindowCreated).toBe(false);
    expect(nativePillHudStarted).toBe(false);
  });

  it('performs clean and idempotent shutdown', () => {
    const controller = createAppLifecycleController(ports);
    controller.start();

    // Shutdown 1
    const shutdown1 = controller.beginShutdown();
    expect(shutdown1).toBe(true);
    expect(keyListenerStopped).toBe(true);
    expect(stopPhoneSyncCalled).toBe(true);
    expect(stopClipboardCalled).toBe(true);
    expect(nativePillHudStopCount).toBe(1);

    // Shutdown 2 (should be idempotent)
    const shutdown2 = controller.beginShutdown();
    expect(shutdown2).toBe(false);
    expect(nativePillHudStopCount).toBe(1);
  });
});
