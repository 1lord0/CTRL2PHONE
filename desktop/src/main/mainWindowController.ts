import { normalizePillVisibility, shouldShowCompactPill } from '../lib/pillVisibility';

export interface MainWindowPort {
  isDestroyed(): boolean;
  getBounds(): { x: number; y: number; width: number; height: number };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setMinimumSize(width: number, height: number): void;
  setMaximumSize(width: number, height: number): void;
  setResizable(resizable: boolean): void;
  setAlwaysOnTop(alwaysOnTop: boolean, level?: any, relative?: number): void;
  setSkipTaskbar(skip: boolean): void;
  setIgnoreMouseEvents(ignore: boolean): void;
  show(): void;
  hide(): void;
  focus(): void;
  isFocused(): boolean;
  setBackgroundColor(color: string): void;
  getNativeWindowHandle?(): Buffer;
  webContents: {
    send(channel: string, ...args: any[]): void;
    isDestroyed(): boolean;
    loadFile(filePath: string): Promise<void>;
    on(event: string, callback: () => void): void;
  };
  on(event: string, callback: () => void): void;
}

export interface MainWindowControllerPorts<WindowType, DisplayType> {
  createWindow(
    bounds: { x: number; y: number; width: number; height: number },
    panelSize: { width: number; height: number },
    useNativePillHud: boolean
  ): WindowType;
  getPrimaryDisplay(): DisplayType;
  getAllDisplays(): DisplayType[];
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): DisplayType;
  getDisplayNearestPoint(point: { x: number; y: number }): DisplayType;
  getCursorScreenPoint(): { x: number; y: number };
  getSettings(): {
    pillVisibility: string;
    panelPinned: boolean;
    panelX?: number;
    panelY?: number;
    hotkeyVk?: number;
    doublePressMs?: number;
    language?: string;
  };
  saveSettings(): void;
  getMainPagePath(page: 'pill' | 'panel'): string;
  sendKeyListenerPanelState(open: boolean): void;
  useNativePillHud(): boolean;
  syncNativePillHud(message?: string): void;
  sendPillHudCommand(command: string): void;
  isSelectionSessionActive(): boolean;
  isSelectionSessionStarting(): boolean;
  log(message: string): void;
  warn(message: string, error?: any): void;
  error(message: string, error?: any): void;
  runWindowShapeHelper?(hwnd: string, mode: 'panel' | 'clear'): void;
}

export interface MainWindowController<WindowType extends MainWindowPort> {
  init(): void;
  getWindow(): WindowType | null;
  getPanelMode(): 'compact' | 'presented';
  getMainWindowPage(): 'pill' | 'panel' | 'none';
  getCompactPillSize(): { width: number; height: number };
  getSavedPillBounds(): { x: number; y: number; width: number; height: number } | null;
  isPillHudElevated(): boolean;
  isTransientPillActive(): boolean;

  panelWindowSize(): { width: number; height: number };
  clampCompactSize(width: number, height: number, display?: any): { width: number; height: number };
  defaultPillPosition(): { x: number; y: number };
  getInitialPanelBounds(): { x: number; y: number; width: number; height: number };
  clampPresentedBounds(bounds: { x: number; y: number; width: number; height: number }): {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  spotlightCenterBounds(): { x: number; y: number; width: number; height: number };
  clampPillBounds(bounds: { x: number; y: number; width: number; height: number }): {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  ensurePillOnScreen(bounds: { x: number; y: number; width: number; height: number }): {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  syncPanelOpenState(): void;
  broadcastPanelMode(): void;
  applyWindowShape(mode: 'compact' | 'presented'): void;
  applyPanelBounds(
    bounds: { x: number; y: number; width: number; height: number },
    mode: 'compact' | 'presented'
  ): void;
  loadMainWindowPage(page: 'pill' | 'panel'): Promise<boolean>;
  compactPillShouldBeVisible(): boolean;
  applyCompactPillVisibility(): void;
  activateTransientPill(): void;
  presentSpotlight(): void;
  dismissSpotlight(force?: boolean): void;
  toggleSpotlight(): void;
  resizeCompactPill(requestedWidth: number, requestedHeight: number): void;
  persistPanelPosition(): void;

  setHudCapturing(active: boolean): void;
  hidePillForScreenshot(): void;
  showPillHudOverOverlay(): void;
  restorePillHudLayer(): void;
  syncCompactPillLayer(): void;

  destroy(): void;
}

const PILL_MIN = { width: 220, height: 44 };
const PILL_MAX = { width: 720, height: 80 };
const PILL_DEFAULT = { width: 320, height: 52 };
const PILL_BG_COLOR = '#121826';
const PANEL_BG_COLOR = '#0a1222';
const WIN32_OPAQUE_PILL = process.platform === 'win32';
const COMPACT_PILL_LEVEL = 'screen-saver';
const COMPACT_PILL_RELATIVE = 1;
const PANEL_PRESENTED = { width: 420, height: 640 };
const PILL_HUD_LEVEL = 'screen-saver';
const PILL_HUD_RELATIVE = 1;

export function createMainWindowController<
  WindowType extends MainWindowPort,
  DisplayType extends {
    bounds: { x: number; y: number; width: number; height: number };
    workArea: { x: number; y: number; width: number; height: number };
  },
>(ports: MainWindowControllerPorts<WindowType, DisplayType>): MainWindowController<WindowType> {
  let mainWindow: WindowType | null = null;
  let panelMode: 'compact' | 'presented' = 'compact';
  let mainWindowPage: 'pill' | 'panel' | 'none' = 'pill';
  let compactPillSize = { ...PILL_DEFAULT };
  let savedPillBounds: { x: number; y: number; width: number; height: number } | null = null;
  let pillHudElevated = false;
  let transientPillActive = false;
  let transientPillTimer: NodeJS.Timeout | null = null;

  let mainWindowPageLoad: {
    window: WindowType;
    page: 'pill' | 'panel' | 'none';
    generation: number;
    promise: Promise<boolean>;
  } | null = null;
  let mainWindowPageLoadGeneration = 0;

  function isWindowUsable(win: WindowType | null | undefined): win is WindowType {
    return Boolean(win && !win.isDestroyed() && !win.webContents.isDestroyed());
  }

  function pillMaxWidthForDisplay(display = ports.getPrimaryDisplay()): number {
    return Math.min(PILL_MAX.width, Math.round(display.workArea.width * 0.62));
  }

  function compactPillBackgroundColor(): string {
    return WIN32_OPAQUE_PILL ? PILL_BG_COLOR : '#00000000';
  }

  function presentedPanelBackgroundColor(): string {
    return WIN32_OPAQUE_PILL ? PANEL_BG_COLOR : '#00000000';
  }

  function ensurePillMouseInput(): void {
    if (!isWindowUsable(mainWindow)) return;
    mainWindow.setIgnoreMouseEvents(false);
  }

  function clearTransientPillTimer(): void {
    if (transientPillTimer) {
      clearTimeout(transientPillTimer);
      transientPillTimer = null;
    }
  }

  function getNativeHwnd(win: WindowType): string {
    if (win.getNativeWindowHandle) {
      const buf = win.getNativeWindowHandle();
      if (buf.length >= 8) {
        return buf.readBigUInt64LE(0).toString();
      }
      return buf.readUInt32LE(0).toString();
    }
    return '0';
  }

  const self: MainWindowController<WindowType> = {
    init() {
      const useNative = ports.useNativePillHud();
      const initialBounds = self.getInitialPanelBounds();
      panelMode = 'compact';
      const startBounds = self.ensurePillOnScreen(initialBounds);
      savedPillBounds = startBounds;
      compactPillSize = { width: startBounds.width, height: startBounds.height };

      const panelSize = self.panelWindowSize();

      mainWindow = ports.createWindow(
        {
          x: useNative ? -20000 : startBounds.x,
          y: useNative ? -20000 : startBounds.y,
          width: useNative ? panelSize.width : startBounds.width,
          height: useNative ? panelSize.height : startBounds.height,
        },
        panelSize,
        useNative
      );

      if (!useNative) {
        mainWindow.on('moved', () => {
          self.persistPanelPosition();
        });
      }

      mainWindow.webContents.on('did-finish-load', () => {
        self.broadcastPanelMode();
        if (
          !ports.useNativePillHud() &&
          isWindowUsable(mainWindow) &&
          mainWindowPage === 'pill' &&
          panelMode === 'compact'
        ) {
          self.applyWindowShape('compact');
          self.applyCompactPillVisibility();
        }
        if (ports.getSettings().panelPinned && panelMode !== 'presented') {
          self.presentSpotlight();
        }
      });

      mainWindow.on('ready-to-show', () => {
        if (
          !ports.useNativePillHud() &&
          panelMode === 'compact' &&
          isWindowUsable(mainWindow) &&
          mainWindowPage === 'pill'
        ) {
          self.applyCompactPillVisibility();
        }
      });

      if (useNative) {
        mainWindowPage = 'none';
        ports.syncNativePillHud();
      } else {
        mainWindowPage = 'pill';
        mainWindow.webContents
          .loadFile(ports.getMainPagePath('pill'))
          .then(() => {
            if (panelMode === 'compact') {
              self.applyCompactPillVisibility();
            }
          })
          .catch((err) => ports.error('Pill page load failed:', err));
      }
    },

    getWindow() {
      return mainWindow;
    },

    getPanelMode() {
      return panelMode;
    },

    getMainWindowPage() {
      return mainWindowPage;
    },

    getCompactPillSize() {
      return compactPillSize;
    },

    getSavedPillBounds() {
      return savedPillBounds;
    },

    isPillHudElevated() {
      return pillHudElevated;
    },

    isTransientPillActive() {
      return transientPillActive;
    },

    panelWindowSize() {
      const work = ports.getPrimaryDisplay().workArea;
      return {
        width: PANEL_PRESENTED.width,
        height: Math.min(PANEL_PRESENTED.height, work.height - 48),
      };
    },

    clampCompactSize(width, height, display) {
      const maxW = pillMaxWidthForDisplay(display);
      return {
        width: Math.min(maxW, Math.max(PILL_MIN.width, Math.round(width))),
        height: Math.min(PILL_MAX.height, Math.max(PILL_MIN.height, Math.round(height))),
      };
    },

    defaultPillPosition() {
      const work = ports.getPrimaryDisplay().workArea;
      return {
        x: work.x + Math.round((work.width - compactPillSize.width) / 2),
        y: work.y + 10,
      };
    },

    getInitialPanelBounds() {
      const settings = ports.getSettings();
      if (settings.panelX !== undefined && settings.panelY !== undefined) {
        return {
          x: settings.panelX,
          y: settings.panelY,
          width: compactPillSize.width,
          height: compactPillSize.height,
        };
      }
      const pill = self.defaultPillPosition();
      return {
        x: pill.x,
        y: pill.y,
        width: compactPillSize.width,
        height: compactPillSize.height,
      };
    },

    clampPresentedBounds(bounds) {
      const size = self.panelWindowSize();
      const display = ports.getDisplayMatching(bounds);
      const work = display.workArea;
      const x = Math.min(Math.max(work.x, bounds.x), work.x + work.width - size.width);
      const y = Math.min(Math.max(work.y, bounds.y), work.y + work.height - size.height);
      return { x, y, width: size.width, height: size.height };
    },

    spotlightCenterBounds() {
      const display = ports.getPrimaryDisplay().workArea;
      const { width, height } = self.panelWindowSize();
      return self.clampPresentedBounds({
        x: display.x + Math.round((display.width - width) / 2),
        y: display.y + Math.round((display.height - height) / 2) - 24,
        width,
        height,
      });
    },

    clampPillBounds(bounds) {
      const display = ports.getDisplayMatching(bounds);
      const work = display.workArea;
      const size = self.clampCompactSize(bounds.width, bounds.height, display);
      const x = Math.min(Math.max(work.x, bounds.x), work.x + work.width - size.width);
      const y = Math.min(Math.max(work.y, bounds.y), work.y + work.height - size.height);
      return { x, y, width: size.width, height: size.height };
    },

    ensurePillOnScreen(bounds) {
      const display = ports.getPrimaryDisplay();
      const work = display.workArea;
      const size = self.clampCompactSize(bounds.width, bounds.height, display);
      return {
        x: work.x + Math.round((work.width - size.width) / 2),
        y: work.y + 10,
        width: size.width,
        height: size.height,
      };
    },

    syncPanelOpenState() {
      ports.sendKeyListenerPanelState(panelMode === 'presented');
    },

    broadcastPanelMode() {
      if (isWindowUsable(mainWindow)) {
        mainWindow.webContents.send('panel-mode', panelMode);
      }
    },

    applyWindowShape(mode) {
      if (mode === 'compact') {
        self.syncCompactPillLayer();
        return;
      }
      if (
        process.platform !== 'win32' ||
        !isWindowUsable(mainWindow) ||
        !ports.runWindowShapeHelper
      )
        return;
      const hwnd = getNativeHwnd(mainWindow);

      setTimeout(() => {
        if (!isWindowUsable(mainWindow) || !ports.runWindowShapeHelper) return;
        mainWindow.setBackgroundColor(PANEL_BG_COLOR);
        for (const m of ['panel', 'clear']) {
          ports.runWindowShapeHelper(hwnd, m as any);
        }
      }, 16);
    },

    applyPanelBounds(bounds, mode) {
      if (!isWindowUsable(mainWindow)) return;
      mainWindow.setIgnoreMouseEvents(false);
      if (mode === 'compact') {
        mainWindow.setSkipTaskbar(true);
        const pill = self.clampPillBounds(bounds);
        compactPillSize = { width: pill.width, height: pill.height };
        mainWindow.setBackgroundColor(compactPillBackgroundColor());
        mainWindow.webContents.send('pill-resized', compactPillSize);
        mainWindow.setBounds(pill);
        mainWindow.setMinimumSize(PILL_MIN.width, PILL_MIN.height);
        mainWindow.setMaximumSize(PILL_MAX.width, PILL_MAX.height);
        self.applyWindowShape('compact');
        return;
      }
      mainWindow.setSkipTaskbar(false);
      mainWindow.setBackgroundColor(presentedPanelBackgroundColor());
      const panel = self.clampPresentedBounds(bounds);
      mainWindow.setResizable(true);
      mainWindow.setMaximumSize(10000, 10000);
      mainWindow.setMinimumSize(1, 1);
      mainWindow.setBounds(panel);
      mainWindow.setMinimumSize(panel.width, panel.height);
      mainWindow.setMaximumSize(panel.width, panel.height);
      mainWindow.setResizable(false);
      self.applyWindowShape('presented');
    },

    loadMainWindowPage(page) {
      if (!isWindowUsable(mainWindow)) return Promise.resolve(false);
      if (ports.useNativePillHud() && page === 'pill') return Promise.resolve(true);

      const win = mainWindow;
      if (mainWindowPageLoad?.window === win && mainWindowPageLoad.page === page) {
        return mainWindowPageLoad.promise;
      }
      if (mainWindowPage === page && !mainWindowPageLoad) return Promise.resolve(true);

      const generation = ++mainWindowPageLoadGeneration;
      mainWindowPage = page;

      const promise = win.webContents
        .loadFile(ports.getMainPagePath(page))
        .then(
          () =>
            mainWindow === win &&
            isWindowUsable(win) &&
            mainWindowPageLoadGeneration === generation &&
            mainWindowPage === page
        )
        .catch((error) => {
          if (mainWindow === win && mainWindowPageLoadGeneration === generation) {
            mainWindowPage = 'none';
            ports.error(`${page} page load failed:`, error);
          }
          return false;
        })
        .finally(() => {
          if (mainWindowPageLoad?.window === win && mainWindowPageLoad.generation === generation) {
            mainWindowPageLoad = null;
          }
        });

      mainWindowPageLoad = { window: win, page, generation, promise };
      return promise;
    },

    compactPillShouldBeVisible() {
      return shouldShowCompactPill(normalizePillVisibility(ports.getSettings().pillVisibility), {
        selectionActive: ports.isSelectionSessionActive(),
        transientActive: transientPillActive,
      });
    },

    applyCompactPillVisibility() {
      if (panelMode !== 'compact') return;
      if (ports.useNativePillHud()) {
        ports.syncNativePillHud();
        return;
      }
      if (!isWindowUsable(mainWindow) || mainWindowPage !== 'pill') return;
      if (self.compactPillShouldBeVisible()) {
        mainWindow.show();
        self.syncCompactPillLayer();
      } else {
        mainWindow.hide();
      }
    },

    activateTransientPill() {
      transientPillActive = true;
      clearTransientPillTimer();
      self.applyCompactPillVisibility();
      transientPillTimer = setTimeout(() => {
        transientPillTimer = null;
        transientPillActive = false;
        self.applyCompactPillVisibility();
      }, 4500);
    },

    presentSpotlight() {
      if (!isWindowUsable(mainWindow)) return;
      if (panelMode === 'presented') {
        mainWindow.focus();
        return;
      }
      if (ports.useNativePillHud()) {
        ports.sendPillHudCommand('HIDE');
      } else {
        savedPillBounds = self.clampPillBounds(mainWindow.getBounds());
        const settings = ports.getSettings();
        settings.panelX = savedPillBounds.x;
        settings.panelY = savedPillBounds.y;
      }
      panelMode = 'presented';
      const panelBounds = self.spotlightCenterBounds();
      self.applyPanelBounds(panelBounds, 'presented');
      mainWindow.setAlwaysOnTop(Boolean(ports.getSettings().panelPinned));
      self.broadcastPanelMode();
      void self.loadMainWindowPage('panel').then(() => {
        if (!isWindowUsable(mainWindow)) return;
        self.applyPanelBounds(panelBounds, 'presented');
        mainWindow.show();
        mainWindow.focus();
        self.syncPanelOpenState();
        self.broadcastPanelMode();
      });
    },

    dismissSpotlight(force = false) {
      if (!isWindowUsable(mainWindow)) return;
      if (panelMode === 'compact') return;
      if (!force && ports.getSettings().panelPinned) return;
      panelMode = 'compact';
      mainWindow.hide();
      mainWindow.setAlwaysOnTop(false);
      if (ports.useNativePillHud()) {
        ports.syncNativePillHud();
        self.syncPanelOpenState();
        self.broadcastPanelMode();
        return;
      }
      const pill = savedPillBounds ?? self.getInitialPanelBounds();
      void self.loadMainWindowPage('pill').then(() => {
        if (!isWindowUsable(mainWindow)) return;
        self.applyPanelBounds(pill, 'compact');
        self.syncPanelOpenState();
        self.broadcastPanelMode();
      });
    },

    toggleSpotlight() {
      if (panelMode === 'presented') {
        self.dismissSpotlight();
      } else {
        self.presentSpotlight();
      }
    },

    resizeCompactPill(requestedWidth, requestedHeight) {
      if (panelMode !== 'compact') return;
      if (ports.useNativePillHud()) {
        const next = self.clampCompactSize(requestedWidth, requestedHeight);
        if (next.width === compactPillSize.width && next.height === compactPillSize.height) return;
        compactPillSize = next;
        ports.sendPillHudCommand(`SIZE:${next.width}:${next.height}`);
        return;
      }
      if (!isWindowUsable(mainWindow) || mainWindowPage !== 'pill') return;
      const prev = mainWindow.getBounds();
      const display = ports.getDisplayMatching(prev);
      const next = self.clampCompactSize(requestedWidth, requestedHeight, display);
      if (next.width === compactPillSize.width && next.height === compactPillSize.height) return;

      compactPillSize = next;
      const pill = self.clampPillBounds({
        x: prev.x,
        y: prev.y,
        width: next.width,
        height: next.height,
      });
      mainWindow.setBackgroundColor(compactPillBackgroundColor());
      mainWindow.webContents.send('pill-resized', next);
      mainWindow.setBounds(pill);
      self.applyWindowShape('compact');
    },

    persistPanelPosition() {
      if (ports.useNativePillHud() || !isWindowUsable(mainWindow)) return;
      if (panelMode !== 'compact') return;
      const bounds = self.clampPillBounds(mainWindow.getBounds());
      const settings = ports.getSettings();
      settings.panelX = bounds.x;
      settings.panelY = bounds.y;
      savedPillBounds = bounds;
      ports.saveSettings();
    },

    setHudCapturing(active) {
      if (ports.useNativePillHud() && panelMode === 'compact') {
        ports.sendPillHudCommand(`CAPTURE:${active ? 1 : 0}`);
      }
      if (isWindowUsable(mainWindow) && mainWindowPage === 'pill') {
        mainWindow.webContents.send('hud-capturing', active);
      }
    },

    hidePillForScreenshot() {
      if (panelMode === 'presented' && !ports.getSettings().panelPinned) {
        self.dismissSpotlight();
        return;
      }
      if (ports.useNativePillHud()) {
        ports.sendPillHudCommand('HIDE');
        return;
      }
      if (!isWindowUsable(mainWindow)) return;
      if (panelMode === 'compact') {
        savedPillBounds = self.clampPillBounds(mainWindow.getBounds());
      }
      mainWindow.hide();
    },

    showPillHudOverOverlay() {
      panelMode = 'compact';
      if (ports.useNativePillHud()) {
        ports.syncNativePillHud();
        pillHudElevated = true;
        self.setHudCapturing(true);
        self.broadcastPanelMode();
        self.syncPanelOpenState();
        return;
      }
      if (!isWindowUsable(mainWindow)) return;
      void self.loadMainWindowPage('pill').then(() => {
        if (!isWindowUsable(mainWindow)) return;
        self.applyPanelBounds(
          self.clampPillBounds(savedPillBounds ?? self.getInitialPanelBounds()),
          'compact'
        );
        mainWindow.setAlwaysOnTop(true, PILL_HUD_LEVEL, PILL_HUD_RELATIVE);
        pillHudElevated = true;
        mainWindow.show();
        self.setHudCapturing(true);
        self.broadcastPanelMode();
        self.syncPanelOpenState();
      });
    },

    restorePillHudLayer() {
      self.setHudCapturing(false);
      if (pillHudElevated) {
        pillHudElevated = false;
      }
      if (panelMode === 'compact' || ports.getSettings().panelPinned) {
        if (ports.useNativePillHud()) {
          ports.syncNativePillHud();
          return;
        }
        if (!isWindowUsable(mainWindow)) return;
        mainWindow.show();
        self.syncCompactPillLayer();
      }
    },

    syncCompactPillLayer() {
      if (!isWindowUsable(mainWindow) || panelMode !== 'compact') return;
      const shouldBeAlwaysOnTop = ports.isSelectionSessionActive() || transientPillActive;
      if (shouldBeAlwaysOnTop) {
        mainWindow.setAlwaysOnTop(true, COMPACT_PILL_LEVEL, COMPACT_PILL_RELATIVE);
      } else {
        mainWindow.setAlwaysOnTop(false);
      }
      ensurePillMouseInput();
    },

    destroy() {
      clearTransientPillTimer();
      mainWindow = null;
    },
  };

  return self;
}
