import {
  createMainWindowController,
  type MainWindowControllerPorts,
  type MainWindowPort,
} from '../src/main/mainWindowController';

class MockWebContents {
  readonly sentMessages: { channel: string; args: any[] }[] = [];
  loadedFiles: string[] = [];
  destroyed = false;
  listeners: Record<string, (() => void)[]> = {};
  
  isDestroyed() {
    return this.destroyed;
  }
  
  send(channel: string, ...args: any[]) {
    this.sentMessages.push({ channel, args });
  }

  async loadFile(filePath: string) {
    this.loadedFiles.push(filePath);
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

class MockMainWindow implements MainWindowPort {
  bounds = { x: 100, y: 100, width: 320, height: 52 };
  minSize = { width: 0, height: 0 };
  maxSize = { width: 10000, height: 10000 };
  resizable = false;
  alwaysOnTop = false;
  alwaysOnTopLevel = '';
  alwaysOnTopRelative = 0;
  ignoreMouseEvents = false;
  shown = false;
  focused = false;
  backgroundColor = '';
  destroyed = false;
  webContents = new MockWebContents();
  listeners: Record<string, (() => void)[]> = {};

  isDestroyed() {
    return this.destroyed;
  }

  getBounds() {
    return this.bounds;
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.bounds = bounds;
  }

  setMinimumSize(width: number, height: number) {
    this.minSize = { width, height };
  }

  setMaximumSize(width: number, height: number) {
    this.maxSize = { width, height };
  }

  setResizable(resizable: boolean) {
    this.resizable = resizable;
  }

  setAlwaysOnTop(alwaysOnTop: boolean, level = '', relative = 0) {
    this.alwaysOnTop = alwaysOnTop;
    this.alwaysOnTopLevel = level;
    this.alwaysOnTopRelative = relative;
  }

  setIgnoreMouseEvents(ignore: boolean) {
    this.ignoreMouseEvents = ignore;
  }

  show() {
    this.shown = true;
  }

  hide() {
    this.shown = false;
  }

  focus() {
    this.focused = true;
  }

  isFocused() {
    return this.focused;
  }

  setBackgroundColor(color: string) {
    this.backgroundColor = color;
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

interface TestDisplay {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

describe('MainWindowController', () => {
  let mockWindow: MockMainWindow | null = null;
  let primaryDisplay: TestDisplay;
  let settings: any;
  let keyListenerPanelState: boolean | null = null;
  let nativePillHudActive = false;
  let selectionSessionActive = false;
  let selectionSessionStarting = false;
  let pillHudCommands: string[] = [];
  let syncedHudMessages: string[] = [];

  const ports: MainWindowControllerPorts<MockMainWindow, TestDisplay> = {
    createWindow: (bounds, panelSize, useNativePillHud) => {
      mockWindow = new MockMainWindow();
      mockWindow.setBounds(bounds);
      return mockWindow;
    },
    getPrimaryDisplay: () => primaryDisplay,
    getAllDisplays: () => [primaryDisplay],
    getDisplayMatching: () => primaryDisplay,
    getDisplayNearestPoint: () => primaryDisplay,
    getCursorScreenPoint: () => ({ x: 200, y: 200 }),
    getSettings: () => settings,
    saveSettings: () => {},
    getMainPagePath: (page) => `C:/mock/path/${page}.html`,
    sendKeyListenerPanelState: (open) => {
      keyListenerPanelState = open;
    },
    useNativePillHud: () => nativePillHudActive,
    syncNativePillHud: (message) => {
      if (message) syncedHudMessages.push(message);
    },
    sendPillHudCommand: (cmd) => {
      pillHudCommands.push(cmd);
    },
    isSelectionSessionActive: () => selectionSessionActive,
    isSelectionSessionStarting: () => selectionSessionStarting,
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  const flushPromises = () => new Promise(resolve => setImmediate(resolve));

  beforeEach(() => {
    mockWindow = null;
    primaryDisplay = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
    };
    settings = {
      pillVisibility: 'always',
      panelPinned: false,
      panelX: undefined,
      panelY: undefined,
    };
    keyListenerPanelState = null;
    nativePillHudActive = false;
    selectionSessionActive = false;
    selectionSessionStarting = false;
    pillHudCommands = [];
    syncedHudMessages = [];
  });

  afterEach(() => {
  });

  it('applies correct dimensions and modes for compact vs presented', () => {
    const controller = createMainWindowController(ports);
    controller.init();
    expect(mockWindow).not.toBeNull();
    
    // Default mode is compact
    expect(controller.getPanelMode()).toBe('compact');
    
    // Switch to presented mode via presentSpotlight
    controller.presentSpotlight();
    expect(controller.getPanelMode()).toBe('presented');
    expect(mockWindow!.bounds.width).toBe(420);
    expect(mockWindow!.bounds.height).toBe(640);
  });

  it('triggers panel mode transition and renderer messages', async () => {
    const controller = createMainWindowController(ports);
    controller.init();

    controller.presentSpotlight();
    await flushPromises();

    expect(keyListenerPanelState).toBe(true);
    
    const modeMsg = mockWindow!.webContents.sentMessages.find(m => m.channel === 'panel-mode');
    expect(modeMsg).toBeDefined();
    expect(modeMsg!.args[0]).toBe('presented');
  });

  it('keeps window always-on-top when selection or transient pill is active', () => {
    const controller = createMainWindowController(ports);
    controller.init();

    // Not always-on-top initially
    expect(mockWindow!.alwaysOnTop).toBe(false);

    // Active selection makes it always-on-top
    selectionSessionActive = true;
    controller.syncCompactPillLayer();
    expect(mockWindow!.alwaysOnTop).toBe(true);

    // Turn off selection, goes back to normal
    selectionSessionActive = false;
    controller.syncCompactPillLayer();
    expect(mockWindow!.alwaysOnTop).toBe(false);
  });

  it('respects pillVisibility rule', () => {
    const controller = createMainWindowController(ports);
    controller.init();

    settings.pillVisibility = 'always';
    controller.applyCompactPillVisibility();
    expect(mockWindow!.shown).toBe(true);

    settings.pillVisibility = 'capture-only';
    controller.applyCompactPillVisibility();
    expect(mockWindow!.shown).toBe(false);
  });

  it('correctly clamps pill bounds on movement and handles window shapes', () => {
    const controller = createMainWindowController(ports);
    controller.init();
    
    // Move window offscreen
    mockWindow!.setBounds({ x: 2000, y: 2000, width: 320, height: 52 });
    mockWindow!.trigger('moved');
    
    // Check that settings are updated with the clamped bounds
    expect(settings.panelX).toBeLessThan(1920);
    expect(settings.panelY).toBeLessThan(1040);
  });

  it('ignores calls on destroyed windows', () => {
    const controller = createMainWindowController(ports);
    controller.init();
    
    mockWindow!.destroyed = true;
    controller.presentSpotlight();
    // Mode remains compact since window is not usable
    expect(controller.getPanelMode()).toBe('compact');
  });
});
