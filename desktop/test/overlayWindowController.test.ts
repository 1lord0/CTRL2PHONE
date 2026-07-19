import {
  createOverlayWindowController,
  type OverlayWindowControllerPorts,
  type OverlayWindowPort,
} from '../src/main/overlayWindowController';

class MockWebContents {
  readonly sentMessages: { channel: string; args: any[] }[] = [];
  loadedFiles: string[] = [];
  destroyed = false;
  onceListeners: Record<string, () => void> = {};
  
  isDestroyed() {
    return this.destroyed;
  }
  
  send(channel: string, ...args: any[]) {
    this.sentMessages.push({ channel, args });
  }

  async loadFile(filePath: string) {
    this.loadedFiles.push(filePath);
  }

  once(event: string, callback: () => void) {
    this.onceListeners[event] = callback;
  }

  triggerOnce(event: string) {
    const cb = this.onceListeners[event];
    if (cb) {
      delete this.onceListeners[event];
      cb();
    }
  }
}

class MockOverlayWindow implements OverlayWindowPort {
  bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  ignoreMouseEvents = true;
  ignoreMouseForward = false;
  shown = false;
  destroyed = false;
  webContents = new MockWebContents();
  listeners: Record<string, (() => void)[]> = {};

  isDestroyed() {
    return this.destroyed;
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.bounds = bounds;
  }

  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }) {
    this.ignoreMouseEvents = ignore;
    this.ignoreMouseForward = options?.forward ?? false;
  }

  showInactive() {
    this.shown = true;
  }

  hide() {
    this.shown = false;
  }

  on(event: string, callback: () => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  trigger(event: string) {
    this.listeners[event]?.forEach(cb => cb());
  }
}

describe('OverlayWindowController', () => {
  let mockWindow: MockOverlayWindow | null = null;
  let virtualBounds: { x: number; y: number; width: number; height: number };
  let isCurrent = true;
  let selectionActive = false;
  let restorePillHudCalled = false;
  let applyCompactPillVisibilityCalled = false;
  let createdWindowsCount = 0;

  const ports: OverlayWindowControllerPorts<MockOverlayWindow> = {
    createWindow: (bounds) => {
      mockWindow = new MockOverlayWindow();
      mockWindow.setBounds(bounds);
      createdWindowsCount++;
      return mockWindow;
    },
    getVirtualBounds: () => virtualBounds,
    getAppPath: () => 'C:/mock/app',
    getPreloadPath: () => 'C:/mock/app/preload-overlay.js',
    isSelectionSessionCurrent: () => isCurrent,
    isSelectionSessionActive: () => selectionActive,
    getSelectionSessionRect: () => null,
    restorePillHudLayer: () => {
      restorePillHudCalled = true;
    },
    applyCompactPillVisibility: () => {
      applyCompactPillVisibilityCalled = true;
    },
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  const flushPromises = () => new Promise(resolve => setImmediate(resolve));

  beforeEach(() => {
    mockWindow = null;
    virtualBounds = { x: 0, y: 0, width: 1920, height: 1080 };
    isCurrent = true;
    selectionActive = true;
    restorePillHudCalled = false;
    applyCompactPillVisibilityCalled = false;
    createdWindowsCount = 0;
  });

  it('reuses the same overlay window and creates it only once', () => {
    const controller = createOverlayWindowController(ports);
    
    const win1 = controller.ensureWindow();
    const win2 = controller.ensureWindow();
    
    expect(win1).toBe(win2);
    expect(createdWindowsCount).toBe(1);
  });

  it('performs show flow in correct order: ready handshake -> render -> showInactive -> enable mouse input', async () => {
    const controller = createOverlayWindowController(ports);
    const win = controller.ensureWindow();
    
    // Start show session
    const showPromise = controller.show('test.png', { x: 0, y: 0, width: 1920, height: 1080 }, 1);
    
    // Handshake: trigger html load complete
    win.webContents.triggerOnce('did-finish-load');
    await flushPromises();

    // Handshake: notify overlay ready
    controller.handleRendererReady();
    await flushPromises();

    // Render: notify render completed
    controller.handleRendered(1);
    await showPromise;

    expect(win.shown).toBe(true);
    expect(win.ignoreMouseEvents).toBe(false); // input enabled at the end
  });

  it('rejects show if renderer handshake times out', async () => {
    jest.useFakeTimers();
    try {
      const controller = createOverlayWindowController(ports);
      const win = controller.ensureWindow();
      
      const showPromise = controller.show('test.png', { x: 0, y: 0, width: 1920, height: 1080 }, 1);
      
      win.webContents.triggerOnce('did-finish-load');
      // allow microtask queue to run so loadPromise resolves and setTimeout is registered
      await Promise.resolve();
      await Promise.resolve();
      
      // Advance timers by 2500ms to trigger the handshake timeout
      jest.advanceTimersByTime(2500);
      
      await expect(showPromise).rejects.toThrow('Overlay renderer initialization handshake timed out');
    } finally {
      jest.useRealTimers();
    }
  });

  it('hides selection overlay and invalidates state', () => {
    const controller = createOverlayWindowController(ports);
    const win = controller.ensureWindow();
    win.shown = true;
    win.ignoreMouseEvents = false;

    controller.hide(1);

    expect(win.shown).toBe(false);
    expect(win.ignoreMouseEvents).toBe(true);
    expect(restorePillHudCalled).toBe(true);
    expect(applyCompactPillVisibilityCalled).toBe(true);
  });

  it('ignores old session overlay-rendered events', async () => {
    const controller = createOverlayWindowController(ports);
    const win = controller.ensureWindow();
    
    const showPromise = controller.show('test.png', { x: 0, y: 0, width: 1920, height: 1080 }, 2);
    
    win.webContents.triggerOnce('did-finish-load');
    controller.handleRendererReady();
    await flushPromises();

    // Receive rendered callback with sessionId 1 (stale session)
    controller.handleRendered(1);
    await flushPromises();

    // Show should still be pending (won't resolve)
    // We expect it to time out eventually or reject if cancelled
    controller.hide(2);
    await expect(showPromise).rejects.toThrow();
  });
});
