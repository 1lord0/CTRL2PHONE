import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  screen,
  shell,
  Display,
  Rectangle,
} from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import screenshot from 'screenshot-desktop';
import { autoUpdater } from 'electron-updater';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createExternalCaptureDisplayCache } from './lib/screenCaptureSource';
import { getVirtualBounds as computeVirtualBounds } from './lib/geometry';
import { analyzeImage, AiProvider } from './lib/aiProviders';
import { extractTextFromImage } from './lib/ocr';
import {
  guardLocalClipboard,
  isLocalClipboardGuarded,
  writeTextToClipboardReliable,
} from './lib/clipboardWrite';
import { resolveLang, getStrings } from './lib/i18n';
import { validateAndResolveAssetPath } from './main/phoneDownloadAsset';
import { attachStdinErrorGuard, bindLineReader, safeWriteStdin } from './lib/childProcess';
import { executeCopySelection } from './lib/copySelection';
import {
  calculateDragPreviewSize,
  executeSelectionElectronDrag,
} from './lib/selectionElectronDrag';
import { resolveApprovedDownloadedFile } from './lib/downloadedFileAccess';
import { createDefaultSettings, createElectronSettingsStore } from './main/settingsStore';
import { createSupabaseRuntime } from './main/supabaseRuntime';
import { createElectronPhoneSyncState } from './main/phoneSyncState';
import { createElectronNotificationController } from './main/notificationController';
import {
  createClipboardSyncController,
  parseMobileClipboardRow,
} from './main/clipboardSyncController';
import { createElectronGeminiWindowController } from './main/geminiWindowController';
import { createPhoneFileSyncController } from './main/phoneFileSyncController';
import {
  createSelectionSessionController,
  SelectionSessionController,
} from './main/selectionSessionController';
import { createSelectionDragAssetStore } from './main/selectionDragAssetStore';

// Controllers
import {
  createMainWindowController,
  MainWindowController,
  MainWindowControllerPorts,
} from './main/mainWindowController';
import {
  createOverlayWindowController,
  OverlayWindowController,
  OverlayWindowControllerPorts,
} from './main/overlayWindowController';
import { createNativePillHudController } from './main/nativePillHudController';
import { createKeyListenerController } from './main/keyListenerController';
import { createGlobalKeyRouter } from './main/globalKeyRouter';
import {
  createAppLifecycleController,
  AppLifecycleController,
  AppLifecycleControllerPorts,
} from './main/appLifecycleController';

// Actions
import { resolveSelectionImage } from './main/selectionImageResolver';
import { executeSelectionAiAction } from './main/selectionAiAction';
import { executeSelectionPhoneAction } from './main/selectionPhoneAction';
import { executeSelectionOcrAction } from './main/selectionOcrAction';

// Registrars
import { registerSettingsIpc } from './main/registerSettingsIpc';
import { registerSelectionIpc } from './main/registerSelectionIpc';
import { registerPanelIpc } from './main/registerPanelIpc';
import { registerStorageIpc } from './main/registerStorageIpc';
import { registerFileIpc } from './main/registerFileIpc';
import { registerGeminiIpc } from './main/registerGeminiIpc';
import { createIpcSenderPolicy } from './main/ipcSenderPolicy';

let downloadedPhoneFiles: string[] = [];
let ocrInFlight = false;
let storagePurgeInFlightGeneration: number | null = null;

const settings = createDefaultSettings();
const settingsStore = createElectronSettingsStore(settings);
const supabaseRuntime = createSupabaseRuntime(settings, {
  createClient: (url, key) => {
    return createSupabaseClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  },
  onInvalidate: () => {
    phoneFileSyncController.stop();
    clipboardSyncController.stopPolling();
  },
});

const phoneSyncState = createElectronPhoneSyncState();
const phoneFileSyncController = createPhoneFileSyncController({
  isEnabled: () => settings.autoCopyFromPhone,
  getContext: () => supabaseRuntime.getContext(),
  isContextCurrent: (context) => supabaseRuntime.isCurrent(context),
  isSynced: (context, filePath, file) => phoneSyncState.isSynced(context, filePath, file),
  markSynced: (context, filePath, file) => phoneSyncState.markSynced(context, filePath, file),
  listRemoteFiles: async (context) => {
    const { data, error } = await context.client.storage.from(context.bucket).list('to_pc', {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    return {
      files: (data ?? []).map((file: any) => ({
        name: file.name,
        id: file.id,
        updated_at: file.updated_at,
      })),
      error: error?.message ?? null,
    };
  },
  downloadFile: async (context, file) => {
    const tempDir = path.join(app.getPath('temp'), 'ctrl2phone');
    const resolution = validateAndResolveAssetPath(file.name, tempDir);
    if (!resolution.ok || !resolution.localPath) {
      console.error(`Phone sync: rejected download name "${file.name}": ${resolution.error}`);
      return null;
    }
    const localPath = resolution.localPath;

    const remotePath = `to_pc/${file.name}`;
    const { data: fileBlob, error } = await context.client.storage
      .from(context.bucket)
      .download(remotePath);
    if (error) {
      console.error(`Phone sync: failed to download ${remotePath}:`, error);
      return null;
    }
    const arrayBuffer = await fileBlob.arrayBuffer();
    if (!supabaseRuntime.isCurrent(context)) return null;
    const buffer = Buffer.from(arrayBuffer);
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) {
      console.error('Phone sync: downloaded file is not a valid image (kept for retry)');
      return null;
    }

    guardLocalClipboard(6000);
    clipboard.writeImage(image);

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(localPath, buffer);
    return localPath;
  },
  deleteRemoteFile: async (context, filePath) => {
    if (!supabaseRuntime.isCurrent(context)) return null;
    const { error } = await context.client.storage.from(context.bucket).remove([filePath]);
    return error?.message ?? null;
  },
  notifyDownloads: (paths) => notifyPhoneDownloads([...paths]),
  subscribe: (context, onFile, onSubscribed) => {
    const channel = context.client
      .channel(`ctrl2phone-to-pc-${context.generation}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'storage',
          table: 'objects',
          filter: `bucket_id=eq.${context.bucket}`,
        },
        (payload: { new?: { name?: string; id?: string; updated_at?: string } }) => {
          const row = payload.new;
          if (!row?.name) return;
          onFile({ name: row.name, id: row.id, updated_at: row.updated_at });
        }
      )
      .subscribe((status: any) => {
        if (status === 'SUBSCRIBED') onSubscribed();
      });
    return { client: context.client, channel };
  },
  removeSubscription: async (subscription) => {
    await subscription.client.removeChannel(subscription.channel);
  },
  log: (message) => console.log(message),
  warn: (message, detail) => console.warn(message, detail ?? ''),
  error: (message, error) => console.error(message, error),
});

const notificationController = createElectronNotificationController(() =>
  appLifecycle.isShutdownStarted()
);
const geminiWindowController = createElectronGeminiWindowController(() =>
  appLifecycle.isShutdownStarted()
);
const clipboardSyncController = createClipboardSyncController({
  readClipboard: () => clipboard.readText(),
  writeClipboard: (value) => clipboard.writeText(value),
  isClipboardGuarded: () => isLocalClipboardGuarded(),
  getContext: () => supabaseRuntime.getContext(),
  isContextCurrent: (context) => supabaseRuntime.isCurrent(context),
  insertDesktopText: async (context, text) => {
    const { error } = await context.client.from('clipboard_sync').insert({
      content: text,
      source: 'desktop',
    });
    return error?.message ?? null;
  },
  fetchOldestMobileText: async (context) => {
    const { data, error } = await context.client
      .from('clipboard_sync')
      .select('*')
      .eq('source', 'mobile')
      .order('created_at', { ascending: true })
      .limit(1);
    return {
      row: parseMobileClipboardRow(data?.[0]),
      error: error?.message ?? null,
    };
  },
  deleteMobileText: async (context, id) => {
    const { error } = await context.client.from('clipboard_sync').delete().eq('id', id);
    return error?.message ?? null;
  },
  setStatus,
  setResponse,
  showNotification: (title, body) => showCustomNotification(title, body, 'sync'),
  log: (message) => console.log(message),
  warn: (message, detail) => console.warn(message, detail ?? ''),
  error: (message, error) => console.error(message, error),
});

const selectionSession: SelectionSessionController<Electron.NativeImage, Display> =
  createSelectionSessionController<Electron.NativeImage, Display>((): boolean =>
    appLifecycle.isShutdownStarted()
  );
const selectionDragAssetStore = createSelectionDragAssetStore({
  getDirectory: () => path.join(app.getPath('temp'), 'ctrl2phone-drag'),
  warn: (message, error) => console.warn(message, error),
});
const externalCaptureDisplayCache = createExternalCaptureDisplayCache(() =>
  screenshot.listDisplays()
);

const PILL_MIN = { width: 220, height: 44 };
const PILL_MAX = { width: 720, height: 80 };
const PILL_BG_COLOR = '#121826';
const WIN32_OPAQUE_PILL = process.platform === 'win32';

function pillMaxWidthForDisplay(display = screen.getPrimaryDisplay()): number {
  return Math.min(PILL_MAX.width, Math.round(display.workArea.width * 0.62));
}

function ensurePillOnScreen(bounds: Rectangle): Rectangle {
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  const size = mainWindowController.clampCompactSize(bounds.width, bounds.height, display);
  return {
    x: work.x + Math.round((work.width - size.width) / 2),
    y: work.y + 10,
    width: size.width,
    height: size.height,
  };
}

function helperExeCandidates(name: string): string[] {
  return [
    path.join(app.getAppPath(), 'assets', name),
    path.join(process.resourcesPath, 'src', name),
    path.join(process.resourcesPath, name),
    path.join(__dirname, name),
    path.join(__dirname, '..', 'src', name),
    path.join(app.getAppPath(), 'src', name),
  ];
}

function getPillHudPath(): string {
  for (const p of helperExeCandidates('pill_hud.exe')) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('pill_hud.exe not found');
}

function getKeyListenerPath(): string {
  for (const p of helperExeCandidates('key_listener.exe')) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('key_listener.exe not found');
}

const imageResolverPorts = {
  isSessionCurrent: (id: number) => selectionSession.isCurrent(id),
  getAnnotatedDataUrl: async () => {
    const overlayWindow = overlayWindowController.getWindow();
    if (!overlayWindow || overlayWindow.isDestroyed()) return null;
    return await overlayWindow.webContents.executeJavaScript(
      'window.__ctrl2phoneCompose ? window.__ctrl2phoneCompose() : null'
    );
  },
  createImageFromDataURL: (url: string) => nativeImage.createFromDataURL(url),
  isEmptyImage: (img: Electron.NativeImage) => img.isEmpty(),
};

async function updateSelectionDragAsset(sessionId: number): Promise<void> {
  if (!selectionSession.dragEnabled) return;
  const snapshot = selectionSession.snapshot(sessionId);
  if (!snapshot) {
    selectionDragAssetStore.invalidate();
    return;
  }
  const generation = selectionDragAssetStore.beginUpdate();
  try {
    const image = await resolveSelectionImage(snapshot, imageResolverPorts);
    if (
      !image ||
      image.isEmpty() ||
      !selectionSession.isCurrent(sessionId) ||
      !selectionDragAssetStore.isCurrent(generation) ||
      !selectionSession.dragEnabled
    ) {
      return;
    }

    const dragDir = path.join(app.getPath('temp'), 'ctrl2phone-drag');
    if (!fs.existsSync(dragDir)) {
      fs.mkdirSync(dragDir, { recursive: true });
    }

    const dragFilePath = path.join(dragDir, `drag-${sessionId}-${generation}.png`);
    fs.writeFileSync(dragFilePath, image.toPNG());

    if (!selectionSession.isCurrent(sessionId) || !selectionDragAssetStore.isCurrent(generation)) {
      selectionDragAssetStore.invalidate();
      selectionDragAssetStore.commit(generation, dragFilePath);
      return;
    }

    if (!selectionDragAssetStore.commit(generation, dragFilePath)) return;

    const overlayWindow = overlayWindowController.getWindow();
    if (overlayWindow && !overlayWindow.isDestroyed() && selectionSession.isCurrent(sessionId)) {
      overlayWindow.webContents.send('selection-drag-state', { sessionId, ready: true });
    }
  } catch (err) {
    console.error('Failed to update selection drag asset:', err);
  }
}

// Port definitions
const mainWindowPorts: MainWindowControllerPorts<BrowserWindow, Display> = {
  createWindow: (bounds: any, panelSize: any, useNative: boolean) => {
    const win = new BrowserWindow({
      x: useNative ? -20000 : bounds.x,
      y: useNative ? -20000 : bounds.y,
      width: useNative ? panelSize.width : bounds.width,
      height: useNative ? panelSize.height : bounds.height,
      minWidth: useNative ? panelSize.width : PILL_MIN.width,
      maxWidth: useNative ? panelSize.width : PILL_MAX.width,
      minHeight: useNative ? panelSize.height : PILL_MIN.height,
      maxHeight: useNative ? panelSize.height : PILL_MIN.height,
      frame: false,
      transparent: useNative ? false : !WIN32_OPAQUE_PILL,
      thickFrame: false,
      hasShadow: false,
      roundedCorners: false,
      resizable: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      focusable: true,
      backgroundColor: useNative ? '#0a1222' : WIN32_OPAQUE_PILL ? PILL_BG_COLOR : '#00000000',
      title: '',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload-main.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        sandbox: false,
      },
    });

    // Prevent navigation to external URLs
    win.webContents.on('will-navigate', (event, url) => {
      const allowedOrigins = ['app://', 'file://'];
      const isAllowed = allowedOrigins.some((origin) => url.startsWith(origin));
      if (!isAllowed) {
        console.warn(`Blocked navigation to: ${url}`);
        event.preventDefault();
      }
    });

    // Prevent opening new windows
    win.webContents.setWindowOpenHandler(({ url }) => {
      console.warn(`Blocked window open to: ${url}`);
      return { action: 'deny' };
    });

    return win;
  },
  getPrimaryDisplay: () => screen.getPrimaryDisplay(),
  getAllDisplays: () => screen.getAllDisplays(),
  getDisplayMatching: (rect: any) => screen.getDisplayMatching(rect),
  getDisplayNearestPoint: (pt: any) => screen.getDisplayNearestPoint(pt),
  getCursorScreenPoint: () => screen.getCursorScreenPoint(),
  getSettings: () => ({
    ...settings,
    pillVisibility: settings.pillVisibility || 'always',
    panelPinned: settings.panelPinned ?? false,
  }),
  saveSettings: () => settingsStore.save(),
  getMainPagePath: (page: 'pill' | 'panel') =>
    path.join(app.getAppPath(), page === 'pill' ? 'pill.html' : 'index.html'),
  sendKeyListenerPanelState: (open: boolean) => {
    const proc = keyListenerController.getProcess();
    if (proc) {
      safeWriteStdin(proc, open ? 'PANEL_OPEN\n' : 'PANEL_CLOSED\n', 'key_listener');
    }
  },
  useNativePillHud: () => nativePillHudController.useNative(),
  syncNativePillHud: (msg?: string) =>
    nativePillHudController.sync(mainWindowController.compactPillShouldBeVisible(), msg),
  sendPillHudCommand: (cmd: string) => nativePillHudController.sendCommand(cmd),
  isSelectionSessionActive: () => selectionSession.active,
  isSelectionSessionStarting: () => selectionSession.starting,
  log: (msg: string) => console.log(msg),
  warn: (msg: string, e: any) => console.warn(msg, e),
  error: (msg: string, e: any) => console.error(msg, e),
  runWindowShapeHelper: (hwnd: string, mode: 'panel' | 'clear') => {
    for (const exe of helperExeCandidates('round_window.exe')) {
      if (fs.existsSync(exe)) {
        spawn(exe, [hwnd, mode], { windowsHide: true });
        break;
      }
    }
  },
};

const overlayPorts: OverlayWindowControllerPorts<BrowserWindow> = {
  createWindow: (bounds: any) => {
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      fullscreenable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload-overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        sandbox: false,
      },
    });

    // Prevent navigation to external URLs
    win.webContents.on('will-navigate', (event, url) => {
      const allowedOrigins = ['app://', 'file://'];
      const isAllowed = allowedOrigins.some((origin) => url.startsWith(origin));
      if (!isAllowed) {
        console.warn(`Blocked navigation to: ${url}`);
        event.preventDefault();
      }
    });

    // Prevent opening new windows
    win.webContents.setWindowOpenHandler(({ url }) => {
      console.warn(`Blocked window open to: ${url}`);
      return { action: 'deny' };
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    return win;
  },
  getVirtualBounds: () => computeVirtualBounds(screen.getAllDisplays()),
  getAppPath: () => app.getAppPath(),
  getPreloadPath: () => path.join(__dirname, 'preload-overlay.js'),
  isSelectionSessionCurrent: (id: number) => selectionSession.isCurrent(id),
  isSelectionSessionActive: () => selectionSession.active,
  getSelectionSessionRect: () => selectionSession.rect,
  restorePillHudLayer: () => mainWindowController.restorePillHudLayer(),
  applyCompactPillVisibility: () => mainWindowController.applyCompactPillVisibility(),
  log: (msg: string) => console.log(msg),
  warn: (msg: string, e: any) => console.warn(msg, e),
  error: (msg: string, e: any) => console.error(msg, e),
};

const nativePillHudPorts = {
  spawn: (bin: string) => spawn(bin, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }),
  getPillHudPath: () => getPillHudPath(),
  attachStdinErrorGuard: (proc: any, name: string) => attachStdinErrorGuard(proc, name),
  bindLineReader: (stream: any, cb: any) => bindLineReader(stream, cb),
  writeStdin: (proc: any, cmd: string) => safeWriteStdin(proc, cmd, 'pill_hud'),
  kill: (proc: any) => {
    try {
      proc.stdin?.end();
    } catch {
      /* ignore */
    }
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  },
  setTimeout: (cb: any, ms: number) => setTimeout(cb, ms),
  clearTimeout: (timer: any) => clearTimeout(timer),
  onReady: () => {
    const ready = selectionSession.active
      ? 'Seçim modu açık'
      : (getStrings(resolveLang(settings.language, app.getLocale()))['status.ready'] ?? 'Hazır');
    nativePillHudController.sync(mainWindowController.compactPillShouldBeVisible(), ready);
  },
  onToggle: () => mainWindowController.toggleSpotlight(),
  onMoved: (x: number, y: number) => {
    // Use the actual coordinates from the native pill, but ensure they stay on screen
    const display = screen.getPrimaryDisplay();
    const work = display.workArea;
    const size = mainWindowController.getCompactPillSize();

    // Clamp coordinates to work area bounds
    const clampedX = Math.max(work.x, Math.min(x, work.x + work.width - size.width));
    const clampedY = Math.max(work.y, Math.min(y, work.y + work.height - size.height));

    settings.panelX = clampedX;
    settings.panelY = clampedY;
    settingsStore.save();
  },
  onResized: (w: number, h: number) => {
    const display = mainWindowController.getSavedPillBounds()
      ? screen.getDisplayMatching(mainWindowController.getSavedPillBounds()!)
      : undefined;
    const size = mainWindowController.clampCompactSize(w, h, display);
    const bounds = mainWindowController.getSavedPillBounds();
    if (bounds) {
      const nextBounds = ensurePillOnScreen({
        ...bounds,
        width: size.width,
        height: size.height,
      });
      settings.panelX = nextBounds.x;
      settings.panelY = nextBounds.y;
      settingsStore.save();
      nativePillHudController.sendCommand(`POS:${nextBounds.x}:${nextBounds.y}`);
    }
  },
  onFailed: () => {},
  getPillMaxWidth: () => pillMaxWidthForDisplay(),
  getSavedPillBounds: () => {
    return ensurePillOnScreen(
      mainWindowController.getSavedPillBounds() ?? mainWindowController.getInitialPanelBounds()
    );
  },
  setSavedPillBounds: (b: any) => {
    settings.panelX = b.x;
    settings.panelY = b.y;
    settingsStore.save();
  },
  getLanguage: () => settings.language,
  getLocale: () => app.getLocale(),
  getStrings: (key: string) =>
    getStrings(resolveLang(settings.language, app.getLocale()))[key] || key,
  activateElectronPillFallback: () => {
    const win = mainWindowController.getWindow();
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(WIN32_OPAQUE_PILL ? PILL_BG_COLOR : '#00000000');
      mainWindowController
        .loadMainWindowPage('pill')
        .then(() => {
          const bounds =
            mainWindowController.getSavedPillBounds() ||
            mainWindowController.getInitialPanelBounds();
          mainWindowController.applyPanelBounds(bounds, 'compact');
          mainWindowController.applyCompactPillVisibility();
        })
        .catch((err: any) => console.error(err));
    }
  },
  log: (msg: string) => console.log(msg),
  warn: (msg: string, e: any) => console.warn(msg, e),
  error: (msg: string, e: any) => console.error(msg, e),
};

const keyListenerPorts = {
  spawn: (bin: string) => spawn(bin, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }),
  getKeyListenerPath: () => getKeyListenerPath(),
  attachStdinErrorGuard: (proc: any, name: string) => attachStdinErrorGuard(proc, name),
  bindLineReader: (stream: any, cb: any) => bindLineReader(stream, cb),
  writeStdin: (proc: any, cmd: string) => safeWriteStdin(proc, cmd, 'key_listener'),
  kill: (proc: any) => {
    try {
      proc.stdin?.end();
    } catch {
      /* ignore */
    }
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  },
  onKeyEvent: (event: string) => globalKeyRouter.route(event),
  onFailed: (msg: string) => setStatus(msg),
  getSettings: () => settings,
  log: (msg: string) => console.log(msg),
  warn: (msg: string, e: any) => console.warn(msg, e),
  error: (msg: string, e: any) => console.error(msg, e),
};

const mainWindowController: MainWindowController<BrowserWindow> =
  createMainWindowController(mainWindowPorts);
const overlayWindowController: OverlayWindowController<BrowserWindow> =
  createOverlayWindowController(overlayPorts);
const nativePillHudController = createNativePillHudController(nativePillHudPorts);
const keyListenerController = createKeyListenerController(keyListenerPorts);

const ipcSenderPolicy = createIpcSenderPolicy({
  getMainWindow: () => mainWindowController.getWindow(),
  getOverlayWindow: () => overlayWindowController.getWindow(),
  getNotificationWindow: () => notificationController.getWindow(),
  mainFrameUrl: pathToFileURL(path.join(app.getAppPath(), 'index.html')).href,
  overlayFrameUrl: pathToFileURL(path.join(app.getAppPath(), 'src', 'overlay.html')).href,
  notificationFrameUrl: pathToFileURL(path.join(app.getAppPath(), 'src', 'notification.html')).href,
});

const originalReset = selectionSession.reset;
selectionSession.reset = (sid: number) => {
  const ok = originalReset(sid);
  if (ok) {
    keyListenerController.setSelectionActive(false);
  }
  return ok;
};

function sendKeyListenerConfig(): void {
  keyListenerController.sendConfig();
}

function setupPhoneSyncPolling(): void {
  phoneFileSyncController.setup();
}

function setupClipboardPolling(): void {
  clipboardSyncController.setupPolling();
}

function setStatus(message: string): void {
  const oneLine = message.replace(/\r?\n/g, ' ').trim();
  if (nativePillHudController.useNative() && mainWindowController.getPanelMode() === 'compact') {
    nativePillHudController.sendCommand(`STATUS:${oneLine}`);
    nativePillHudController.sendCommand('ACTIVE');
  }
  const mainWindow = mainWindowController.getWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const sendToRenderer =
      (mainWindowController.getMainWindowPage() === 'panel' &&
        mainWindowController.getPanelMode() === 'presented') ||
      (mainWindowController.getMainWindowPage() === 'pill' &&
        mainWindowController.getPanelMode() === 'compact');
    if (sendToRenderer) {
      mainWindow.webContents.send('status', oneLine);
    }
  }
  if (
    !selectionSession.active &&
    !selectionSession.starting &&
    mainWindowController.getPanelMode() === 'compact'
  ) {
    mainWindowController.activateTransientPill();
  }
}

function setResponse(message: string): void {
  const mainWindow = mainWindowController.getWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('response', message);
  }
}

function showCustomNotification(
  title: string,
  body: string,
  type: 'sync' | 'info' | 'error' = 'info'
): void {
  notificationController.show(title, body, type);
}

function broadcastPhoneDownloads(): void {
  const mainWindow = mainWindowController.getWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const filesList = downloadedPhoneFiles.map((filePath) => {
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext);
    return {
      path: filePath,
      name,
      isImage,
    };
  });
  mainWindow.webContents.send('phone-downloads-updated', filesList);
}

function notifyPhoneDownloads(downloadedLocalPaths: string[]): void {
  if (downloadedLocalPaths.length === 0) return;

  downloadedPhoneFiles.push(...downloadedLocalPaths);
  broadcastPhoneDownloads();

  const count = downloadedLocalPaths.length;
  const title = count > 1 ? 'Telefondan Dosyalar Alındı' : 'Telefondan Dosya Alındı';
  const body =
    count > 1 ? `${count} adet dosya yüzen çubuğa eklendi!` : 'Yeni dosya yüzen çubuğa eklendi!';
  showCustomNotification(title, body, 'sync');

  setStatus(
    downloadedLocalPaths.length > 1
      ? `${downloadedLocalPaths.length} dosya telefondan alındı`
      : 'Dosya telefondan alındı'
  );
  setResponse(
    `${downloadedLocalPaths.length} adet dosya telefondan alındı. Yüzen çubuktan sürükleyerek alabilirsiniz.`
  );
}

async function captureAndSend(sessionId: number): Promise<void> {
  const snapshot = selectionSession.snapshot(sessionId);
  if (!snapshot) return;

  const ports = {
    isSelectionSessionCurrent: (id: number) => selectionSession.isCurrent(id),
    isActionCurrent: (id: number) => selectionSession.isActionCurrent(id),
    beginSelectionAction: (id: number) => selectionSession.beginAction(id),
    endSelectionAction: (id: number) => selectionSession.endAction(id),
    writeImageToClipboard: (img: Electron.NativeImage) => clipboard.writeImage(img),
    isApiProviderConfigured: () => {
      if (settings.aiProvider === 'web') return false;
      if (settings.aiProvider === 'custom') return Boolean(settings.aiBaseUrl.trim());
      return Boolean(settings.aiApiKey.trim());
    },
    getPrompt: () => settings.prompt,
    hideSelectionOverlay: (id: number) => overlayWindowController.hide(id),
    resetSelectionSession: (id: number) => selectionSession.reset(id),
    setStatus: (msg: string) => setStatus(msg),
    setResponse: (msg: string) => setResponse(msg),
    activateTransientPill: () => mainWindowController.activateTransientPill(),
    analyzeImage: async (image: Electron.NativeImage, prompt: string) => {
      const provider = settings.aiProvider;
      const config = {
        provider: provider as AiProvider,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
        baseUrl: settings.aiBaseUrl,
      };
      return await analyzeImage(config, image.toPNG().toString('base64'), prompt);
    },
    getAiProviderName: () => settings.aiProvider,
    openGeminiWindow: () => geminiWindowController.open(),
    focusComposer: (win: any, prompt: string) => geminiWindowController.focusComposer(win, prompt),
    sendPasteShortcut: (win: any) => geminiWindowController.sendPasteShortcut(win),
    resolveSelectionImage: async () => {
      return await resolveSelectionImage(snapshot, imageResolverPorts);
    },
  };
  return executeSelectionAiAction(sessionId, ports);
}

async function captureAndSendToSupabase(sessionId: number): Promise<boolean> {
  const snapshot = selectionSession.snapshot(sessionId);
  if (!snapshot) return false;

  const ports = {
    isSelectionSessionCurrent: (id: number) => selectionSession.isCurrent(id),
    isActionCurrent: (id: number) => selectionSession.isActionCurrent(id),
    beginSelectionAction: (id: number) => selectionSession.beginAction(id),
    endSelectionAction: (id: number) => selectionSession.endAction(id),
    getSupabaseContext: () => supabaseRuntime.getContext(),
    isSupabaseContextCurrent: (ctx: any) => supabaseRuntime.isCurrent(ctx),
    hideSelectionOverlay: (id: number) => overlayWindowController.hide(id),
    resetSelectionSession: (id: number) => selectionSession.reset(id),
    setStatus: (msg: string) => setStatus(msg),
    setResponse: (msg: string) => setResponse(msg),
    activateTransientPill: () => mainWindowController.activateTransientPill(),
    uploadToSupabase: async (context: any, fileName: string, buffer: Buffer) => {
      return await context.client.storage.from(context.bucket).upload(fileName, buffer, {
        contentType: 'image/png',
        upsert: true,
      });
    },
    createSignedUrl: async (context: any, fileName: string) => {
      const { data: signed } = await context.client.storage
        .from(context.bucket)
        .createSignedUrl(fileName, 60 * 60 * 24 * 7);
      return signed?.signedUrl ?? null;
    },
    generateRandomUUID: () => randomUUID(),
    resolveSelectionImage: async () => {
      return await resolveSelectionImage(snapshot, imageResolverPorts);
    },
    getImagePngBuffer: (image: Electron.NativeImage) => image.toPNG(),
  };
  return executeSelectionPhoneAction(sessionId, ports);
}

async function captureAndOcr(sessionId: number): Promise<void> {
  const snapshot = selectionSession.snapshot(sessionId);
  if (!snapshot) return;

  const ports = {
    isSelectionSessionCurrent: (id: number) => selectionSession.isCurrent(id),
    isActionCurrent: (id: number) => selectionSession.isActionCurrent(id),
    beginSelectionAction: (id: number) => selectionSession.beginAction(id),
    endSelectionAction: (id: number) => selectionSession.endAction(id),
    isOcrInFlight: () => ocrInFlight,
    setOcrInFlight: (val: boolean) => {
      ocrInFlight = val;
    },
    hideSelectionOverlay: (id: number) => overlayWindowController.hide(id),
    resetSelectionSession: (id: number) => selectionSession.reset(id),
    setStatus: (msg: string) => setStatus(msg),
    setResponse: (msg: string) => setResponse(msg),
    activateTransientPill: () => mainWindowController.activateTransientPill(),
    guardLocalClipboard: (ms: number) => guardLocalClipboard(ms),
    writeTextToClipboardReliable: (txt: string) => writeTextToClipboardReliable(txt),
    extractTextFromImage: async (pngBuffer: Buffer) => {
      const aiConfig =
        settings.aiProvider !== 'web'
          ? {
              provider: settings.aiProvider as AiProvider,
              apiKey: settings.aiApiKey,
              model: settings.aiModel,
              baseUrl: settings.aiBaseUrl,
            }
          : null;
      return await extractTextFromImage(pngBuffer, { aiConfig });
    },
    getProviderName: () => settings.aiProvider,
    resolveSelectionImage: async () => {
      return await resolveSelectionImage(snapshot, imageResolverPorts);
    },
    getImagePngBuffer: (image: Electron.NativeImage) => image.toPNG(),
  };
  return executeSelectionOcrAction(sessionId, ports);
}

async function uploadFileToPhone(filePath: string): Promise<boolean> {
  const context = supabaseRuntime.getContext();
  if (!context) {
    setStatus('Supabase ayarları eksik! Lütfen ayarlardan doldurun.');
    mainWindowController.activateTransientPill();
    return false;
  }
  try {
    const fileStat = await fs.promises.stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error('Dosya bulunamadı.');
    }
    const fileBuffer = await fs.promises.readFile(filePath);
    const baseName = path.basename(filePath);
    const cleanBaseName = baseName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `upload_${Date.now()}_${cleanBaseName}`;

    setStatus("Dosya Supabase'e yükleniyor...");
    const { error } = await context.client.storage
      .from(context.bucket)
      .upload(fileName, fileBuffer, {
        upsert: true,
      });
    if (error) {
      throw new Error(`Upload hatası: ${error.message}`);
    }

    let shareUrl = '';
    try {
      const { data: signed } = await context.client.storage
        .from(context.bucket)
        .createSignedUrl(fileName, 60 * 60 * 24 * 7);
      shareUrl = signed?.signedUrl ?? '';
    } catch {
      // ignore
    }

    setResponse(
      shareUrl
        ? `Telefona başarıyla yüklendi!\nDosya Adresi (7 gün geçerli):\n${shareUrl}`
        : 'Telefona başarıyla yüklendi! Dosyayı telefon uygulamasından görüntüleyebilirsin.'
    );
    setStatus('Dosya telefona gönderildi');
    mainWindowController.activateTransientPill();
    return true;
  } catch (error: unknown) {
    console.error('Failed to upload file to phone:', error);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Yükleme başarısız: ${message}`);
    mainWindowController.activateTransientPill();
    return false;
  }
}

async function startSelectionSession(): Promise<void> {
  const sessionId = selectionSession.start();
  if (sessionId === null) return;
  selectionDragAssetStore.invalidate();
  mainWindowController.setHudCapturing(true);
  mainWindowController.applyCompactPillVisibility();

  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    selectionSession.setDisplay(sessionId, activeDisplay);

    mainWindowController.hidePillForScreenshot();

    const tScreenshotStart = Date.now();
    const captureDisplay = await externalCaptureDisplayCache.resolve(activeDisplay);
    if (!captureDisplay) {
      throw new Error(`Active display could not be mapped for capture: ${activeDisplay.id}`);
    }
    const imageBuffer = await screenshot({ format: 'png', screen: captureDisplay.id });
    if (!imageBuffer) {
      throw new Error('Ekran görüntüsü kütüphanesi boş veya tanımsız veri döndürdü');
    }
    const tScreenshotEnd = Date.now();
    console.log(`[PERF] [t1] Screenshot hazır. Süre: ${tScreenshotEnd - tScreenshotStart}ms`);

    if (!selectionSession.isCurrent(sessionId) || appLifecycle.isShutdownStarted()) return;

    const capturedScreenImage = nativeImage.createFromBuffer(imageBuffer);
    if (capturedScreenImage.isEmpty()) {
      throw new Error('Captured screen image is empty');
    }
    const previewBase64 = capturedScreenImage.toJPEG(82).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${previewBase64}`;

    if (!selectionSession.activate(sessionId, capturedScreenImage)) return;
    keyListenerController.setSelectionActive(true);

    const tShowOverlayStart = Date.now();
    await overlayWindowController.show(dataUrl, activeDisplay.bounds, sessionId);
    const tShowOverlayEnd = Date.now();
    console.log(
      `[PERF] [t2] showSelectionOverlay bitti. Süre: ${tShowOverlayEnd - tShowOverlayStart}ms`
    );

    if (!selectionSession.isCurrent(sessionId) || appLifecycle.isShutdownStarted()) return;

    mainWindowController.showPillHudOverOverlay();
    overlayWindowController.sendInstruction(
      'Alanı seç → X/Enter: Gemini · M: Telefon · C: OCR · Esc: iptal',
      sessionId
    );
    setStatus('Seçim modu açık. Alanı fareyle çiz.');
  } catch (error: any) {
    console.error('Ekran yakalama hatası:', error);
    setStatus('Ekran yakalama başlatılamadı: ' + error.message);
    mainWindowController.setHudCapturing(false);
    mainWindowController.restorePillHudLayer();
    if (selectionSession.isCurrent(sessionId)) {
      overlayWindowController.hide(sessionId);
      selectionSession.reset(sessionId);
    }
  } finally {
    selectionSession.finishStarting(sessionId);
  }
}

const keyRouterPorts = {
  isSelectionActive: () => selectionSession.active,
  hasSelectionRect: () => selectionSession.rect !== null,
  isActionBusy: () => selectionSession.actionInFlightSessionId !== null,
  isShutdownStarted: () => appLifecycle.isShutdownStarted(),
  setStatus: (msg: string) => setStatus(msg),
  log: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
  startSelectionSession,
  captureAndSend: () => {
    void captureAndSend(selectionSession.sessionId);
  },
  captureAndSendToSupabase: () => {
    void captureAndSendToSupabase(selectionSession.sessionId);
  },
  captureAndOcr: () => {
    void captureAndOcr(selectionSession.sessionId);
  },
  sendClipboardToPhone: () => {
    clipboardSyncController
      .sendToPhone()
      .catch((e) => console.error('Failed to sync clipboard:', e));
  },
  toggleSpotlight: () => mainWindowController.toggleSpotlight(),
  dismissSpotlight: () => mainWindowController.dismissSpotlight(true),
  cancelSelection: () => {
    const sid = selectionSession.sessionId;
    overlayWindowController.hide(sid);
    selectionSession.reset(sid);
  },
  quitApplication: () => appLifecycle.beginShutdown() && app.quit(),
};

function cleanupPhoneSyncDownloads(): void {
  const tempDir = path.join(app.getPath('temp'), 'ctrl2phone');
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    console.error('Failed to cleanup phone sync downloads:', err);
  }
}

const globalKeyRouter = createGlobalKeyRouter(keyRouterPorts);

const lifecyclePorts: AppLifecycleControllerPorts<typeof app, typeof screen> = {
  app,
  screen,
  settingsStore,
  phoneSyncState,
  mainWindowController,
  overlayWindowController,
  keyListenerController,
  nativePillHudController,
  cleanupStaleSelectionDragFiles: () => selectionDragAssetStore.cleanupStaleFiles(),
  cleanupPhoneSyncDownloads: () => cleanupPhoneSyncDownloads(),
  setupPhoneSyncPolling,
  setupClipboardPolling,
  stopPhoneSyncPolling: () => phoneFileSyncController.stop(),
  stopClipboardPolling: () => clipboardSyncController.stopPolling(),
  externalCaptureDisplayCache,
  geminiWindowController,
  autoUpdater,
  selectionSession: {
    shutdown: () => selectionSession.shutdown(),
  },
  invalidateSelectionDragAsset: () => selectionDragAssetStore.invalidate(),
  notificationController: {
    shutdown: () => notificationController.shutdown(),
  },
  setTimeout: (cb: any, ms: number) => setTimeout(cb, ms),
  clearTimeout: (timer: any) => clearTimeout(timer),
  log: (msg: string) => console.log(msg),
  warn: (msg: string, e: any) => console.warn(msg, e),
  error: (msg: string, e: any) => console.error(msg, e),
};

const appLifecycle: AppLifecycleController = createAppLifecycleController(lifecyclePorts);

// IPC dependencies mapping
const ipcDeps = {
  settings,
  settingsStore,
  mainWindowController,
  overlayWindowController,
  selectionSession,
  selectionDragAssetStore,
  supabaseRuntime,
  phoneSyncState,
  notificationController,
  clipboardSyncController,
  geminiWindowController,
  phoneFileSyncController,
  get downloadedPhoneFiles() {
    return downloadedPhoneFiles;
  },

  executeCopySelection,
  resolveSelectionImage: (snapshot: any) => resolveSelectionImage(snapshot, imageResolverPorts),
  writeImageToClipboard: (img: any) => clipboard.writeImage(img),
  readImageFromClipboard: () => clipboard.readImage(),
  setStatus,
  sendOverlayState: (state: any) => {
    const win = overlayWindowController.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('overlay-state', state);
    }
  },
  updateSelectionDragAsset,
  getDisplayNearestPoint: (pt: any) => screen.getDisplayNearestPoint(pt),
  getCursorScreenPoint: () => screen.getCursorScreenPoint(),
  captureAndSend,
  captureAndSendToSupabase,
  captureAndOcr,
  startSelectionSession,
  isShutdownStarted: () => appLifecycle.isShutdownStarted(),
  getStoragePurgeInFlightGeneration: () => storagePurgeInFlightGeneration,
  setStoragePurgeInFlightGeneration: (val: number | null) => {
    storagePurgeInFlightGeneration = val;
  },
  quitApplication: () => {
    appLifecycle.beginShutdown() && app.quit();
  },
  sendClipboardToPhone: () => clipboardSyncController.sendToPhone(),

  isMainSender: (sender: any) => ipcSenderPolicy.isMain(sender),
  isOverlaySender: (sender: any) => ipcSenderPolicy.isOverlay(sender),

  // File IPC helpers
  isMainWindowSender: (sender: any) => ipcSenderPolicy.isMain(sender),
  uploadFileToPhone,
  getDownloadedPhoneFiles: () => downloadedPhoneFiles,
  resolveMainWindowDownload: (sender: any, reqPath: any) => {
    if (!ipcSenderPolicy.isMain(sender)) return null;
    return resolveApprovedDownloadedFile(reqPath, downloadedPhoneFiles);
  },
  unlinkFile: async (filePath: string) => await fs.promises.unlink(filePath),
  removeDownloadedFile: (filePath: string) => {
    downloadedPhoneFiles = downloadedPhoneFiles.filter((p) => p !== filePath);
  },
  broadcastPhoneDownloads,
  createNativeImageFromPath: (filePath: string) => nativeImage.createFromPath(filePath),
  createNativeImageFromBuffer: (buffer: Buffer) => nativeImage.createFromBuffer(buffer),
  calculateDragPreviewSize,
  executeSelectionElectronDrag,
  fileExistsSync: (filePath: string) => fs.existsSync(filePath),

  // Settings IPC helpers
  getLocale: () => app.getLocale(),
  getPillMaxWidth: () => pillMaxWidthForDisplay(),
  writeTextToClipboardReliable: (txt: string) => writeTextToClipboardReliable(txt),
  shellOpenExternal: async (url: string) => await shell.openExternal(url),
  sendKeyListenerConfig,
  setupPhoneSyncPolling,
  setupClipboardPolling,
};

// Register all IPC routes
registerSettingsIpc(ipcMain, ipcDeps);
registerSelectionIpc(ipcMain, ipcDeps);
registerPanelIpc(ipcMain, ipcDeps);
registerStorageIpc(ipcMain, ipcDeps);
registerFileIpc(ipcMain, ipcDeps);
registerGeminiIpc(ipcMain, ipcDeps);

// Last-resort safety net
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// Auto-updater error registration
autoUpdater.on('error', (err: any) => {
  console.error('Error in auto-updater:', err);
});

// Start the application
appLifecycle.start();
