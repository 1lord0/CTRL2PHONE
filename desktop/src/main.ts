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
import { analyzeActionIntent } from './lib/actionIntentAnalyzer';
import { extractTextFromImage } from './lib/ocr';
import {
  guardLocalClipboard,
  isLocalClipboardGuarded,
  writeTextToClipboardReliable,
} from './lib/clipboardWrite';
import { resolveLang, getStrings } from './lib/i18n';
import { createPhoneDownloadAssetStore } from './main/phoneDownloadAsset';
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
import { createClipboardSyncController } from './main/clipboardSyncController';
import { createElectronGeminiWindowController } from './main/geminiWindowController';
import { createPhoneFileSyncController } from './main/phoneFileSyncController';
import { createElectronPhoneSyncAdapter } from './main/electronPhoneSyncAdapter';
import { createElectronClipboardSyncAdapter } from './main/electronClipboardSyncAdapter';
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
import { createElectronLifecycleComposition } from './main/electronLifecycleComposition';

// Actions
import { resolveSelectionImage } from './main/selectionImageResolver';
import { executeSelectionAiAction } from './main/selectionAiAction';
import { executeSelectionPhoneAction } from './main/selectionPhoneAction';
import { executeSelectionOcrAction } from './main/selectionOcrAction';
import { executeSelectionWorkflowAction } from './main/selectionWorkflowAction';
import { createActionWorkflowRuntime } from './main/actionWorkflowRuntime';
import { createElectronActionWorkflowStateStore } from './main/actionWorkflowStateStore';
import { createElectronActionTaskMonitor } from './main/electronActionTaskMonitor';

// Registrars
import { registerSettingsIpc } from './main/registerSettingsIpc';
import { registerSelectionIpc } from './main/registerSelectionIpc';
import { registerPanelIpc } from './main/registerPanelIpc';
import { registerStorageIpc } from './main/registerStorageIpc';
import { registerFileIpc } from './main/registerFileIpc';
import { registerGeminiIpc } from './main/registerGeminiIpc';
import { createIpcSenderPolicy } from './main/ipcSenderPolicy';
import { runPackagedSmoke } from './main/packagedSmoke';
import { createDiagnosticsLogger } from './main/diagnosticsLogger';
import { registerDiagnosticsIpc } from './main/registerDiagnosticsIpc';

let downloadedPhoneFiles: string[] = [];
let ocrInFlight = false;
let storagePurgeInFlightGeneration: number | null = null;

const packagedSmokeReportPath = process.env.CTRL2PHONE_PACKAGED_SMOKE_REPORT;
const packagedSmokeUserData = process.env.CTRL2PHONE_PACKAGED_SMOKE_USER_DATA;
if (packagedSmokeReportPath && packagedSmokeUserData) {
  if (!path.isAbsolute(packagedSmokeReportPath) || !path.isAbsolute(packagedSmokeUserData)) {
    throw new Error('Packaged smoke paths must be absolute.');
  }
  fs.mkdirSync(packagedSmokeUserData, { recursive: true });
  app.setPath('userData', packagedSmokeUserData);
}

const diagnostics = createDiagnosticsLogger({
  rootDir: path.join(app.getPath('userData'), 'diagnostics'),
  appVersion: app.getVersion(),
  packaged: app.isPackaged,
});

const settings = createDefaultSettings();
const settingsStore = createElectronSettingsStore(settings);
const actionWorkflowStateStore = createElectronActionWorkflowStateStore();
const phoneDownloadAssetStorePromise = createPhoneDownloadAssetStore(app.getPath('temp'));

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

let actionSupabaseClient: ReturnType<typeof createSupabaseClient> | null = null;
let actionSupabaseUrl = '';
let actionSupabaseKey = '';

function getActionSupabaseConnection(): {
  context: { client: ReturnType<typeof createSupabaseClient>; url: string };
  url: string;
} | null {
  if (!settings.supabaseUrl || !settings.supabaseKey) return null;
  if (
    !actionSupabaseClient ||
    actionSupabaseUrl !== settings.supabaseUrl ||
    actionSupabaseKey !== settings.supabaseKey
  ) {
    actionSupabaseClient = createSupabaseClient(settings.supabaseUrl, settings.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    actionSupabaseUrl = settings.supabaseUrl;
    actionSupabaseKey = settings.supabaseKey;
  }
  return {
    context: { client: actionSupabaseClient, url: actionSupabaseUrl },
    url: actionSupabaseUrl,
  };
}

const actionWorkflowRuntime = createActionWorkflowRuntime<any>({
  getConnection: getActionSupabaseConnection,
  isConnectionCurrent: (context) =>
    !appLifecycle.isShutdownStarted() &&
    context.client === actionSupabaseClient &&
    context.url === settings.supabaseUrl &&
    actionSupabaseKey === settings.supabaseKey,
  getWebhookConfig: () => ({
    url: settings.actionWebhookUrl,
    secret: settings.actionWebhookSecret,
  }),
  stateStore: actionWorkflowStateStore,
  restoreSession: async (context, auth) => {
    const { data, error } = await context.client.auth.setSession({
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
    });
    if (error || !data.session) return null;
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  },
  signInAnonymously: async (context) => {
    const { data, error } = await context.client.auth.signInAnonymously();
    if (error || !data.session) {
      throw new Error(`action_anonymous_auth_failed: ${error?.message || 'session_missing'}`);
    }
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  },
  createChannel: async (context, input) => {
    const { data, error } = await context.client.rpc('create_action_channel', {
      p_name: input.name,
      p_invite_token: input.inviteToken,
      p_invite_expires_at: input.inviteExpiresAt,
    });
    if (error || typeof data !== 'string') {
      throw new Error(`action_channel_create_failed: ${error?.message || 'channel_id_missing'}`);
    }
    return data;
  },
  rotateChannelInvite: async (context, input) => {
    const { data, error } = await context.client.rpc('rotate_action_channel_invite', {
      p_channel_id: input.channelId,
      p_invite_token: input.inviteToken,
      p_invite_expires_at: input.inviteExpiresAt,
    });
    if (error || data !== input.channelId) {
      throw new Error(
        `action_channel_invite_rotate_failed: ${error?.message || 'channel_mismatch'}`
      );
    }
  },
  uploadActionInput: async (context, bucket, objectPath, pngBuffer) => {
    const { error } = await context.client.storage.from(bucket).upload(objectPath, pngBuffer, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) throw new Error(`action_input_upload_failed: ${error.message}`);
  },
  enqueueTask: async (context, input) => {
    const { data, error } = await context.client.rpc('enqueue_action_task', {
      p_channel_id: input.channelId,
      p_idempotency_key: input.idempotencyKey,
      p_request_hash: input.requestHash,
      p_source_device_id: input.sourceDeviceId,
      p_source_storage_path: input.sourceStoragePath,
      p_title: input.title,
    });
    if (error) {
      throw new Error(`action_task_enqueue_failed: ${error.message}`);
    }
    const taskId =
      typeof data === 'string'
        ? data.trim()
        : typeof (data as any)?.id === 'string'
          ? (data as any).id
          : '';
    if (!taskId) {
      throw new Error(
        `action_task_enqueue_failed: task_id_missing (raw_data: ${JSON.stringify(data)})`
      );
    }
    return taskId;
  },
  dispatchWebhook: async ({ url, secret, idempotencyKey, payload }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    if (timeout.unref) timeout.unref();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ctrl2phone-secret': secret,
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`action_webhook_http_${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  },
});

const actionTaskMonitor = createElectronActionTaskMonitor({
  getContext: () => getActionSupabaseConnection()?.context ?? null,
  isContextCurrent: (context) =>
    !appLifecycle.isShutdownStarted() &&
    context.client === actionSupabaseClient &&
    context.url === settings.supabaseUrl &&
    actionSupabaseKey === settings.supabaseKey,
  publish: (task) => {
    const mainWindow = mainWindowController.getWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('action-task-updated', task);
    }
    diagnostics.info('action_workflow', 'task_update_received', {
      taskId: task.id,
      status: task.workflowStatus,
      progress: task.progress,
      version: task.version,
    });

    if (task.workflowStatus === 'completed') {
      const summary = task.summary || task.title;
      setStatus('Action sonucu hazÄ±r');
      setResponse(summary);
      showCustomNotification('Action tamamlandÄ±', task.title, 'info');
      mainWindowController.activateTransientPill();
    } else if (task.workflowStatus === 'failed') {
      diagnostics.error(
        'action_workflow',
        'task_failed',
        new Error(task.errorMessage ?? task.errorCode ?? 'action_task_failed'),
        {
          taskId: task.id,
          errorCode: task.errorCode,
          progress: task.progress,
          version: task.version,
        }
      );
      const message = task.errorMessage || task.errorCode || 'Bilinmeyen iÅŸ akÄ±ÅŸÄ± hatasÄ±';
      setStatus('Action iÅŸ akÄ±ÅŸÄ± baÅŸarÄ±sÄ±z');
      setResponse(`Action hatasÄ±: ${message}`);
      showCustomNotification('Action baÅŸarÄ±sÄ±z', message, 'error');
      mainWindowController.activateTransientPill();
    } else if (task.workflowStatus === 'cancelled') {
      setStatus('Action gÃ¶revi iptal edildi');
      mainWindowController.activateTransientPill();
    } else {
      setStatus(`Action iÅŸleniyor: %${task.progress}`);
    }
  },
  warn: (message, detail) => {
    diagnostics.warn('action_workflow', 'task_monitor_warning', { message, detail });
  },
  error: (message, error) => {
    diagnostics.error('action_workflow', 'task_monitor_error', error, { message });
  },
});

const phoneSyncState = createElectronPhoneSyncState();
const electronPhoneSyncAdapter = createElectronPhoneSyncAdapter({
  isEnabled: () => settings.autoCopyFromPhone,
  runtime: supabaseRuntime,
  state: phoneSyncState,
  downloadStore: phoneDownloadAssetStorePromise,
  createImageFromBuffer: (buffer) => nativeImage.createFromBuffer(buffer),
  writeClipboardImage: (image) => clipboard.writeImage(image),
  guardLocalClipboard,
  notifyDownloads: (paths) => notifyPhoneDownloads(paths),
  log: (message) => {
    diagnostics.info('phone_sync', 'runtime_message', { message });
    console.log(message);
  },
  warn: (message, detail) => {
    diagnostics.warn('phone_sync', 'runtime_warning', { message, detail });
    console.warn(message, detail ?? '');
  },
  error: (message, error) => {
    diagnostics.error('phone_sync', 'runtime_error', error ?? message, { message });
    console.error(message, error ?? '');
  },
});
const phoneFileSyncController = createPhoneFileSyncController(electronPhoneSyncAdapter.ports);

const notificationController = createElectronNotificationController(() =>
  appLifecycle.isShutdownStarted()
);
const geminiWindowController = createElectronGeminiWindowController(() =>
  appLifecycle.isShutdownStarted()
);
const clipboardSyncController = createClipboardSyncController(
  createElectronClipboardSyncAdapter({
    runtime: supabaseRuntime,
    readClipboard: () => clipboard.readText(),
    writeClipboard: (value) => clipboard.writeText(value),
    isClipboardGuarded: () => isLocalClipboardGuarded(),
    setStatus,
    setResponse,
    showNotification: (title, body) => showCustomNotification(title, body, 'sync'),
    log: (message) => console.log(message),
    warn: (message, detail) => console.warn(message, detail ?? ''),
    error: (message, error) => console.error(message, error),
  })
);

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
      title: 'Ctrl2Phone',
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

function setStatus(message: string): void {
  const oneLine = message.replace(/\r?\n/g, ' ').trim();
  diagnostics.info('status', 'status_changed', { message: oneLine });
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

async function captureAndRunAction(sessionId: number): Promise<boolean> {
  const snapshot = selectionSession.snapshot(sessionId);
  if (!snapshot) return false;

  return executeSelectionWorkflowAction(sessionId, {
    isSelectionSessionCurrent: (id) => selectionSession.isCurrent(id),
    isActionCurrent: (id) => selectionSession.isActionCurrent(id),
    beginSelectionAction: (id) => selectionSession.beginAction(id),
    endSelectionAction: (id) => selectionSession.endAction(id),
    resolveSelectionImage: async () => resolveSelectionImage(snapshot, imageResolverPorts),
    getImagePngBuffer: (image) => image.toPNG(),
    analyzeIntent: (pngBuffer) =>
      analyzeActionIntent(pngBuffer, {
        apiKey: settings.aiApiKey,
        model: settings.aiProvider === 'gemini' ? settings.aiModel : undefined,
      }),
    submitAction: async (input) => {
      const result = await actionWorkflowRuntime.submit(input);
      void actionTaskMonitor.watch(result.taskId).catch((error) => {
        diagnostics.error('action_workflow', 'task_monitor_start_failed', error, {
          taskId: result.taskId,
        });
      });
      return result;
    },
    hideSelectionOverlay: (id) => overlayWindowController.hide(id),
    resetSelectionSession: (id) => selectionSession.reset(id),
    setStatus: (message) => setStatus(message),
    setResponse: (message) => setResponse(message),
    activateTransientPill: () => mainWindowController.activateTransientPill(),
    reportError: (stage, error, details) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ACTION_DEBUG] Stage: ${stage}, Error: ${errorMessage}`, details ?? {});
      diagnostics.error('action_workflow', stage, error, {
        sessionId,
        ...(details ?? {}),
      });
    },
    reportEvent: (stage, details) => {
      diagnostics.info('action_workflow', stage, {
        sessionId,
        ...(details ?? {}),
      });
    },
  });
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
      const startedAt = Date.now();
      diagnostics.action('supabase.selection_upload_started', {
        sessionId,
        bucket: context.bucket,
        byteLength: buffer.length,
        fileExtension: path.extname(fileName),
      });
      const result = await context.client.storage.from(context.bucket).upload(fileName, buffer, {
        contentType: 'image/png',
        upsert: true,
      });
      if (!result.error) {
        diagnostics.info('supabase', 'selection_upload_succeeded', {
          sessionId,
          bucket: context.bucket,
          byteLength: buffer.length,
          durationMs: Date.now() - startedAt,
        });
      }
      return result;
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
    reportError: (stage: string, error: unknown, details?: Record<string, unknown>) => {
      diagnostics.error('supabase', stage, error, {
        sessionId,
        ...(details ?? {}),
      });
    },
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
    diagnostics.error(
      'supabase',
      'file_upload_missing_settings',
      new Error('Supabase URL or Anon Key is missing'),
      { fileExtension: path.extname(filePath) },
      'validation'
    );
    setStatus('Supabase ayarları eksik! Lütfen ayarlardan doldurun.');
    mainWindowController.activateTransientPill();
    return false;
  }
  try {
    const uploadStartedAt = Date.now();
    const fileStat = await fs.promises.stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error('Dosya bulunamadı.');
    }
    const fileBuffer = await fs.promises.readFile(filePath);
    const baseName = path.basename(filePath);
    const cleanBaseName = baseName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `upload_${Date.now()}_${cleanBaseName}`;

    diagnostics.action('supabase.file_upload_started', {
      bucket: context.bucket,
      byteLength: fileBuffer.length,
      fileExtension: path.extname(baseName),
    });

    setStatus("Dosya Supabase'e yükleniyor...");
    const { error } = await context.client.storage
      .from(context.bucket)
      .upload(fileName, fileBuffer, {
        upsert: true,
      });
    if (error) {
      throw new Error(`Upload hatası: ${error.message}`);
    }

    diagnostics.info('supabase', 'file_upload_succeeded', {
      bucket: context.bucket,
      byteLength: fileBuffer.length,
      durationMs: Date.now() - uploadStartedAt,
    });

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
    diagnostics.error('supabase', 'file_upload_failed', error, {
      bucket: context.bucket,
      fileExtension: path.extname(filePath),
    });
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
      'Alanı seç → A: Action · X/Enter: Gemini · M: Telefon · C: OCR · Esc: iptal',
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
  action: (name: string, details?: Readonly<Record<string, unknown>>) =>
    diagnostics.action(name, details),
  startSelectionSession,
  captureAndSend: () => {
    void captureAndSend(selectionSession.sessionId);
  },
  captureAndRunAction: () => {
    void captureAndRunAction(selectionSession.sessionId);
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
  quitApplication: () => quitApplication(),
};

const globalKeyRouter = createGlobalKeyRouter(keyRouterPorts);

const lifecycleComposition = createElectronLifecycleComposition({
  app,
  screen,
  settingsStore,
  phoneSyncState,
  mainWindowController,
  overlayWindowController,
  keyListenerController,
  nativePillHudController,
  selectionDragAssetStore,
  phoneDownloadAdapter: electronPhoneSyncAdapter,
  phoneFileSyncController,
  clipboardSyncController,
  stopActionTaskMonitoring: () => actionTaskMonitor.stopAndDrain(),
  externalCaptureDisplayCache,
  geminiWindowController,
  autoUpdater,
  selectionSession,
  notificationController,
  setTimeout: (cb: any, ms: number) => setTimeout(cb, ms),
  clearTimeout: (timer: any) => clearTimeout(timer),
  log: (msg: string) => console.log(msg),
  warn: (msg: string, e: any) => console.warn(msg, e),
  error: (msg: string, e: any) => console.error(msg, e),
});

const appLifecycle = lifecycleComposition.controller;

let explicitQuitStarted = false;

function quitApplication(): void {
  if (explicitQuitStarted) return;
  explicitQuitStarted = true;
  diagnostics.action('app.quit_requested');

  // A stuck network/subscription drain must never turn the visible X button into
  // a no-op. Prefer the graceful controller shutdown, but bound it and guarantee
  // that the Electron process exits.
  const forcedExitTimer = setTimeout(() => {
    diagnostics.error(
      'lifecycle',
      'forced_shutdown_timeout',
      new Error('Graceful shutdown exceeded 2500ms'),
      undefined,
      'shutdown'
    );
    diagnostics.close('forced_shutdown');
    app.exit(0);
  }, 2_500);
  void appLifecycle
    .beginShutdown()
    .catch((error) => {
      diagnostics.error('lifecycle', 'graceful_shutdown_failed', error, undefined, 'shutdown');
      console.error('Graceful shutdown failed:', error);
    })
    .finally(() => {
      clearTimeout(forcedExitTimer);
      diagnostics.close('graceful_shutdown');
      app.exit(0);
    });
}

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
  captureAndRunAction,
  captureAndSendToSupabase,
  captureAndOcr,
  startSelectionSession,
  isShutdownStarted: () => appLifecycle.isShutdownStarted(),
  getStoragePurgeInFlightGeneration: () => storagePurgeInFlightGeneration,
  setStoragePurgeInFlightGeneration: (val: number | null) => {
    storagePurgeInFlightGeneration = val;
  },
  quitApplication,
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
  setupPhoneSyncPolling: lifecycleComposition.setupPhoneSyncPolling,
  setupClipboardPolling: lifecycleComposition.setupClipboardPolling,
  stopActionTaskMonitor: () => actionTaskMonitor.stopAndDrain(),
  createActionPairingInvite: () => actionWorkflowRuntime.createPairingInvite(),
  diagnostics,
};

// Register all IPC routes
registerSettingsIpc(ipcMain, ipcDeps);
registerSelectionIpc(ipcMain, ipcDeps);
registerPanelIpc(ipcMain, ipcDeps);
registerStorageIpc(ipcMain, ipcDeps);
registerFileIpc(ipcMain, ipcDeps);
registerGeminiIpc(ipcMain, ipcDeps);
registerDiagnosticsIpc(ipcMain, {
  isMainSender: (sender) => ipcSenderPolicy.isMain(sender),
  diagnostics,
});

// Last-resort safety net
process.on('unhandledRejection', (reason) => {
  diagnostics.error('process', 'unhandled_promise_rejection', reason);
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtExceptionMonitor', (error, origin) => {
  diagnostics.error('process', 'uncaught_exception', error, { origin });
});

process.on('exit', (code) => {
  diagnostics.close(`process_exit_${code}`);
});

// Auto-updater error registration
autoUpdater.on('error', (err: any) => {
  diagnostics.error('updater', 'auto_update_failed', err);
  console.error('Error in auto-updater:', err);
});

// Start the application
appLifecycle.start();

if (packagedSmokeReportPath) {
  void runPackagedSmoke({
    app,
    mainWindowController,
    reportPath: packagedSmokeReportPath,
  });
}
