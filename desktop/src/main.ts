import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  screen,
  shell,
  Display,
  type WebContents,
} from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import screenshot from 'screenshot-desktop';
import { selectExternalCaptureDisplay } from './lib/screenCaptureSource';
import QRCode from 'qrcode';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { autoUpdater } from 'electron-updater';
import { AppSettings, Rect } from './types';
import {
  getVirtualBounds as computeVirtualBounds,
  toAbsoluteRect as computeAbsoluteRect,
  clampRectToDisplay,
  computeCropRect,
} from './lib/geometry';
import { buildRlsSetupSql } from './lib/supabaseSetup';
import { analyzeImage, AiProvider } from './lib/aiProviders';
import { extractTextFromImage } from './lib/ocr';
import {
  guardLocalClipboard,
  isLocalClipboardGuarded,
  writeTextToClipboardReliable,
} from './lib/clipboardWrite';
import { resolveLang, getStrings } from './lib/i18n';
import { attachStdinErrorGuard, bindLineReader, safeWriteStdin } from './lib/childProcess';
import { normalizePillVisibility, shouldShowCompactPill } from './lib/pillVisibility';
import { activateSelectionOverlay } from './lib/overlayActivation';
import { executeCopySelection, CopySelectionPorts } from './lib/copySelection';
import { calculateDragPreviewSize, executeSelectionElectronDrag } from './lib/selectionElectronDrag';
import { resolveApprovedDownloadedFile } from './lib/downloadedFileAccess';
import { createDefaultSettings, createElectronSettingsStore } from './main/settingsStore';
import {
  createSupabaseRuntime,
  type SupabaseRuntimeContext,
} from './main/supabaseRuntime';
import { createElectronPhoneSyncState } from './main/phoneSyncState';

// GPU acceleration is enabled (required for native startDrag to work on Windows)

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let geminiWindow: BrowserWindow | null = null;
let notificationWindow: BrowserWindow | null = null;
let pendingNotification: { title: string; body: string; type: 'success' | 'info' | 'error' | 'sync' } | null = null;
let notificationRendererReady = false;
let notificationGeneration = 0;
let notificationDismissTimer: NodeJS.Timeout | null = null;
let notificationCloseTimer: NodeJS.Timeout | null = null;
let selectionActive = false;
let selectionStarting = false;
let selectionHasAnnotations = false;
let selectionRect: Rect | null = null;
let selectionDisplay: Display | null = null;
let capturedScreenImage: Electron.NativeImage | null = null;
let selectionSessionId = 0;
let selectionActionInFlightSessionId: number | null = null;
let selectionDragGeneration = 0;
let selectionDragEnabled = false;
let selectionSessionStartTime = 0;
let currentSelectionDragFilePath: string | null = null;
let downloadedPhoneFiles: string[] = [];
let keyListenerProcess: ChildProcess | null = null;
let pillHudProcess: ChildProcess | null = null;
let useNativePillHud = false;
let nativeHudDisabledForRun = false;
let pillHudReadyTimer: NodeJS.Timeout | null = null;
const intentionallyStoppedPillHuds = new WeakSet<ChildProcess>();
let shutdownStarted = false;
let phoneSyncInFlightGeneration: number | null = null;
let storagePurgeInFlightGeneration: number | null = null;
let overlayLifecycle: {
  window: BrowserWindow;
  generation: number;
  loadPromise: Promise<void>;
  rendererReadyPromise: Promise<void>;
  resolveRendererReady: () => void;
  rendererReady: boolean;
} | null = null;
let overlayGeneration = 0;
let pendingRenderWaiter: {
  sessionId: number;
  generation: number;
  resolve: () => void;
  reject: (err: Error) => void;
} | null = null;

function clearPendingRenderWaiter(): void {
  if (pendingRenderWaiter) {
    pendingRenderWaiter.reject(new Error('Render waiter cleared/cancelled'));
    pendingRenderWaiter = null;
  }
}
function sendSelectionDragState(sessionId: number, ready: boolean, reason?: string): void {
  if (overlayWindow && !overlayWindow.isDestroyed() && isSelectionSessionCurrent(sessionId)) {
    overlayWindow.webContents.send('selection-drag-state', { sessionId, ready, reason });
  }
}
let transientPillActive = false;
let transientPillTimer: NodeJS.Timeout | null = null;
let mainWindowPageLoad: {
  window: BrowserWindow;
  page: 'pill' | 'panel' | 'none';
  generation: number;
  promise: Promise<boolean>;
} | null = null;
let mainWindowPageLoadGeneration = 0;
let clipboardCheckInFlightGeneration: number | null = null;
let _pillHudFallbackInFlight: Promise<void> | null = null;

const settings = createDefaultSettings();
const settingsStore = createElectronSettingsStore(settings);
const supabaseRuntime = createSupabaseRuntime<SupabaseClient>(settings, {
  createClient: (url, key) =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  onInvalidate: () => {
    stopPhoneSyncPolling();
    stopClipboardPolling();
    phoneSyncInFlightGeneration = null;
  },
});
const phoneSyncState = createElectronPhoneSyncState();

const PILL_MIN = { width: 220, height: 44 };
const PILL_MAX = { width: 720, height: 80 };
const PILL_DEFAULT = { width: 320, height: 52 };
const PILL_BG_COLOR = '#121826';
const PANEL_BG_COLOR = '#0a1222';
const WIN32_OPAQUE_PILL = process.platform === 'win32';
const COMPACT_PILL_LEVEL = 'screen-saver';
const COMPACT_PILL_RELATIVE = 1;

function pillMaxWidthForDisplay(display = screen.getPrimaryDisplay()): number {
  return Math.min(PILL_MAX.width, Math.round(display.workArea.width * 0.62));
}
const PANEL_PRESENTED = { width: 420, height: 640 };
let compactPillSize = { ...PILL_DEFAULT };
const PILL_HUD_LEVEL = 'screen-saver';
const PILL_HUD_RELATIVE = 1;
let panelMode: 'compact' | 'presented' = 'compact';
let savedPillBounds: Electron.Rectangle | null = null;
let pillHudElevated = false;
let mainWindowPage: 'pill' | 'panel' | 'none' = 'pill';


const geminiUrl = 'https://gemini.google.com/app';

let phoneSyncInterval: NodeJS.Timeout | null = null;
let phoneSyncChannel: RealtimeChannel | null = null;
const PHONE_SYNC_LIST_LIMIT = 100;
const PHONE_SYNC_BATCH_LIMIT = 10;
let clipboardSyncInterval: NodeJS.Timeout | null = null;
let lastProcessedClipboardId: string | null = null;
let ocrInFlight = false;

function isWindowUsable(window: BrowserWindow | null | undefined): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function stopPhoneSyncPolling(): void {
  if (phoneSyncInterval) {
    clearInterval(phoneSyncInterval);
    phoneSyncInterval = null;
  }
  const channel = phoneSyncChannel;
  const channelClient = supabaseRuntime.currentClient();
  phoneSyncChannel = null;
  if (channel && channelClient) {
    void channelClient.removeChannel(channel).catch((err) => {
      console.warn('Phone sync channel teardown failed:', err);
    });
  }
}

function stopClipboardPolling(): void {
  if (clipboardSyncInterval) {
    clearInterval(clipboardSyncInterval);
    clipboardSyncInterval = null;
  }
}

function beginShutdown(): boolean {
  if (shutdownStarted) return false;
  shutdownStarted = true;
  (app as any).isQuitting = true;
  overlayGeneration += 1;
  selectionSessionId += 1;
  selectionActive = false;
  selectionDragEnabled = false;
  selectionStarting = false;
  selectionActionInFlightSessionId = null;
  invalidateSelectionDragAsset();
  clearTransientPillTimer();
  transientPillActive = false;
  notificationGeneration += 1;
  pendingNotification = null;
  clearNotificationTimers();
  overlayLifecycle?.resolveRendererReady();
  stopNativePillHud();
  stopKeyListener();
  stopPhoneSyncPolling();
  stopClipboardPolling();
  return true;
}

function quitApplication(): void {
  beginShutdown();
  app.quit();
}

async function sendClipboardToPhone(): Promise<{ ok: boolean; error?: string }> {
  const text = clipboard.readText();
  if (!text || !text.trim()) {
    setStatus('Panoda kopyalanmış metin bulunamadı');
    return { ok: false, error: 'Panoda metin yok' };
  }
  const context = getSupabaseContext();
  if (!context) {
    setStatus('Supabase ayarları eksik!');
    return { ok: false, error: 'Supabase ayarları eksik' };
  }
  const { client } = context;
  try {
    const { error } = await client.from('clipboard_sync').insert({
      content: text.trim(),
      source: 'desktop',
    });

    if (error) throw new Error(error.message);

    if (!isSupabaseContextCurrent(context)) {
      return { ok: false, error: 'Supabase ayarları gönderim sırasında değişti' };
    }

    const preview = text.trim().length > 60 ? text.trim().substring(0, 60) + '...' : text.trim();
    showCustomNotification('Metin Telefona Gönderildi', preview, 'sync');

    setStatus('Pano metni telefona gönderildi');
    setResponse(`Gönderilen metin: ${text.trim().substring(0, 200)}`);
    return { ok: true };
  } catch (err: any) {
    console.error('Clipboard send error:', err);
    setStatus('Metin gönderme hatası: ' + err.message);
    return { ok: false, error: err.message };
  }
}

async function checkClipboardFromMobile(): Promise<void> {
  // Don't stomp a fresh local OCR / RLS copy with a stale mobile row.
  if (isLocalClipboardGuarded()) return;
  const context = getSupabaseContext();
  if (!context) return;
  if (clipboardCheckInFlightGeneration === context.generation) return;
  const { client } = context;
  clipboardCheckInFlightGeneration = context.generation;
  try {
    const { data, error } = await client
      .from('clipboard_sync')
      .select('*')
      .eq('source', 'mobile')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.warn('Clipboard poll error:', error.message);
      return;
    }

    if (!isSupabaseContextCurrent(context) || isLocalClipboardGuarded()) {
      return;
    }

    if (data && data.length > 0) {
      const row = data[0];
      if (row.id !== lastProcessedClipboardId) {
        lastProcessedClipboardId = row.id;
        const content = row.content;
        if (content) {
          clipboard.writeText(content);
          const preview = content.length > 60 ? content.substring(0, 60) + '...' : content;
          showCustomNotification('Telefondan Metin Alındı', preview, 'sync');
          setStatus('Telefondan metin alındı');
          setResponse(`Alınan metin: ${content.substring(0, 200)}`);
        }
      }

      // Always try to delete the record from database to keep it clean
      const { error: deleteError } = await client.from('clipboard_sync').delete().eq('id', row.id);
      if (deleteError) {
        console.warn('Clipboard row cleanup failed:', deleteError.message);
      }
    }
  } catch (err) {
    console.error('checkClipboardFromMobile error:', err);
  } finally {
    if (clipboardCheckInFlightGeneration === context.generation) {
      clipboardCheckInFlightGeneration = null;
    }
  }
}

function setupClipboardPolling(): void {
  stopClipboardPolling();

  const context = getSupabaseContext();
  if (!context) {
    console.log('Clipboard polling: waiting for Supabase settings');
    return;
  }

  clipboardSyncInterval = setInterval(checkClipboardFromMobile, 1500);
  console.log('Clipboard polling initialized (1.5s)');
}

type SupabaseContext = SupabaseRuntimeContext<SupabaseClient>;

function getSupabaseContext(): SupabaseContext | null {
  return supabaseRuntime.getContext();
}

function isSupabaseContextCurrent(context: SupabaseContext): boolean {
  return supabaseRuntime.isCurrent(context);
}

function isValidPhoneFileName(name: string | null | undefined): name is string {
  return Boolean(name && name !== '.keep' && !name.startsWith('.'));
}

async function tryDeleteRemotePhoneFile(
  context: SupabaseContext,
  filePath: string
): Promise<void> {
  if (!isSupabaseContextCurrent(context)) return;
  const { error } = await context.client.storage.from(context.bucket).remove([filePath]);
  if (error) {
    console.warn(`Phone sync: remote delete failed for ${filePath}:`, error.message);
  }
}

async function processPhoneFile(
  context: SupabaseContext,
  fileName: string,
  batchIndex: number,
  meta?: { id?: string | null; updated_at?: string | null }
): Promise<string | null> {
  const filePath = `to_pc/${fileName}`;
  if (phoneSyncState.isSynced(context, filePath, meta)) {
    return null;
  }

  const { data: fileBlob, error: downloadError } = await context.client.storage
    .from(context.bucket)
    .download(filePath);
  if (downloadError) {
    console.error(`Phone sync: failed to download ${filePath}:`, downloadError);
    return null;
  }

  const arrayBuffer = await fileBlob.arrayBuffer();
  if (!isSupabaseContextCurrent(context)) return null;

  const buffer = Buffer.from(arrayBuffer);
  const image = nativeImage.createFromBuffer(buffer);

  if (image.isEmpty()) {
    console.error('Phone sync: downloaded file is not a valid image (kept for retry)');
    return null;
  }

  if (!isLocalClipboardGuarded()) {
    clipboard.writeImage(image);
  }

  const parts = fileName.split('.');
  const extension = parts[parts.length - 1] || 'png';
  const tempDir = path.join(app.getPath('temp'), 'ctrl2phone');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const localFilePath = path.join(tempDir, `phone_${Date.now()}_${batchIndex}.${extension}`);
  fs.writeFileSync(localFilePath, buffer);

  phoneSyncState.markSynced(context, filePath, meta);
  await tryDeleteRemotePhoneFile(context, filePath);
  return localFilePath;
}

function broadcastPhoneDownloads(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const filesList = downloadedPhoneFiles.map(filePath => {
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
    count > 1
      ? `${count} adet dosya yüzen çubuğa eklendi!`
      : 'Yeni dosya yüzen çubuğa eklendi!';
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

async function cleanupSyncedRemotePhoneFiles(
  context: SupabaseContext,
  files: { name?: string | null; id?: string | null; updated_at?: string | null }[]
): Promise<void> {
  for (const file of files) {
    if (!isSupabaseContextCurrent(context)) return;
    if (!isValidPhoneFileName(file.name)) continue;
    const filePath = `to_pc/${file.name}`;
    if (phoneSyncState.isSynced(context, filePath, file)) {
      await tryDeleteRemotePhoneFile(context, filePath);
    }
  }
}

async function syncPhoneFileByPath(
  filePath: string,
  meta?: { id?: string | null; updated_at?: string | null }
): Promise<void> {
  const context = getSupabaseContext();
  if (!context) return;
  if (!filePath.startsWith('to_pc/')) return;

  const fileName = filePath.slice('to_pc/'.length);
  if (!isValidPhoneFileName(fileName)) return;
  if (phoneSyncState.isSynced(context, filePath, meta)) {
    await tryDeleteRemotePhoneFile(context, filePath);
    return;
  }
  if (phoneSyncInFlightGeneration === context.generation) return;

  phoneSyncInFlightGeneration = context.generation;
  try {
    const localPath = await processPhoneFile(context, fileName, 0, meta);
    if (localPath && isSupabaseContextCurrent(context)) {
      notifyPhoneDownloads([localPath]);
    }
  } catch (err) {
    console.error('Error in syncPhoneFileByPath:', err);
  } finally {
    if (phoneSyncInFlightGeneration === context.generation) {
      phoneSyncInFlightGeneration = null;
    }
  }
}

async function checkPhoneSync(): Promise<void> {
  if (!settings.autoCopyFromPhone) {
    return;
  }

  const context = getSupabaseContext();
  if (!context) return;

  if (phoneSyncInFlightGeneration === context.generation) {
    return;
  }
  phoneSyncInFlightGeneration = context.generation;

  try {
    const { data: files, error } = await context.client.storage.from(context.bucket).list('to_pc', {
      limit: PHONE_SYNC_LIST_LIMIT,
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error) {
      console.warn('Phone sync list error:', error.message);
      return;
    }

    if (!isSupabaseContextCurrent(context)) return;

    if (!files || files.length === 0) {
      return;
    }

    const pending = files.filter((file) => {
      if (!isValidPhoneFileName(file.name)) return false;
      return !phoneSyncState.isSynced(context, `to_pc/${file.name}`, file);
    });

    if (pending.length === 0) {
      await cleanupSyncedRemotePhoneFiles(context, files);
      return;
    }

    const downloadedLocalPaths: string[] = [];
    const batch = pending.slice(0, PHONE_SYNC_BATCH_LIMIT);

    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      if (!isSupabaseContextCurrent(context)) return;
      if (!isValidPhoneFileName(file.name)) continue;
      const localPath = await processPhoneFile(context, file.name, i, file);
      if (localPath) {
        downloadedLocalPaths.push(localPath);
      }
    }

    if (isSupabaseContextCurrent(context)) {
      notifyPhoneDownloads(downloadedLocalPaths);
    }
  } catch (err: any) {
    console.error('Error in checkPhoneSync:', err);
  } finally {
    if (phoneSyncInFlightGeneration === context.generation) {
      phoneSyncInFlightGeneration = null;
    }
  }
}

function setupPhoneSyncPolling(): void {
  stopPhoneSyncPolling();

  if (!settings.autoCopyFromPhone) {
    console.log('Phone sync: disabled by settings');
    return;
  }

  const context = getSupabaseContext();
  if (!context) {
    console.log('Phone sync: waiting for Supabase settings');
    return;
  }

  const { client, bucket, generation } = context;

  // Realtime push: react instantly when the phone uploads into to_pc/. Requires
  // the one-time setup SQL (storage.objects in the realtime publication + anon
  // SELECT policy). If unavailable, the slow fallback poll below still works.
  phoneSyncChannel = client
    .channel(`ctrl2phone-to-pc-${generation}`)
    .on(
      'postgres_changes',
      // bucket_id == bucket name for user-created Supabase buckets.
      { event: 'INSERT', schema: 'storage', table: 'objects', filter: `bucket_id=eq.${bucket}` },
      (payload: { new?: { name?: string; id?: string; updated_at?: string } }) => {
        if (!isSupabaseContextCurrent(context)) return;
        const row = payload?.new;
        const name = row?.name ?? '';
        if (name.startsWith('to_pc/')) {
          void syncPhoneFileByPath(name, row);
        }
      }
    )
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED' && isSupabaseContextCurrent(context)) {
        // Catch anything that arrived while we were disconnected.
        void checkPhoneSync();
      }
    });

  // Safety-net poll, far slower than the old 4s, so sync still works even when
  // Realtime is unavailable or the publication was not enabled.
  phoneSyncInterval = setInterval(checkPhoneSync, 15000);

  console.log('Phone sync: realtime + 15s fallback initialized');
  void checkPhoneSync();
}

function panelWindowSize(): { width: number; height: number } {
  const work = screen.getPrimaryDisplay().workArea;
  return {
    width: PANEL_PRESENTED.width,
    height: Math.min(PANEL_PRESENTED.height, work.height - 48),
  };
}

function clampCompactSize(
  width: number,
  height: number,
  display?: Electron.Display
): { width: number; height: number } {
  const maxW = pillMaxWidthForDisplay(display);
  return {
    width: Math.min(maxW, Math.max(PILL_MIN.width, Math.round(width))),
    height: Math.min(PILL_MAX.height, Math.max(PILL_MIN.height, Math.round(height))),
  };
}

function defaultPillPosition(): { x: number; y: number } {
  const work = screen.getPrimaryDisplay().workArea;
  return {
    x: work.x + Math.round((work.width - compactPillSize.width) / 2),
    y: work.y + 10,
  };
}

function getInitialPanelBounds(): Electron.Rectangle {
  const pill = defaultPillPosition();
  return {
    x: pill.x,
    y: pill.y,
    width: compactPillSize.width,
    height: compactPillSize.height,
  };
}

function clampPresentedBounds(bounds: Electron.Rectangle): Electron.Rectangle {
  const size = panelWindowSize();
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;
  const x = Math.min(Math.max(work.x, bounds.x), work.x + work.width - size.width);
  const y = Math.min(Math.max(work.y, bounds.y), work.y + work.height - size.height);
  return { x, y, width: size.width, height: size.height };
}

function spotlightCenterBounds(): Electron.Rectangle {
  const display = screen.getPrimaryDisplay().workArea;
  const { width, height } = panelWindowSize();
  return clampPresentedBounds({
    x: display.x + Math.round((display.width - width) / 2),
    y: display.y + Math.round((display.height - height) / 2) - 24,
    width,
    height,
  });
}

function clampPillBounds(bounds: Electron.Rectangle): Electron.Rectangle {
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;
  const size = clampCompactSize(bounds.width, bounds.height, display);
  const x = Math.min(Math.max(work.x, bounds.x), work.x + work.width - size.width);
  const y = Math.min(Math.max(work.y, bounds.y), work.y + work.height - size.height);
  return { x, y, width: size.width, height: size.height };
}

function ensurePillOnScreen(bounds: Electron.Rectangle): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  const size = clampCompactSize(bounds.width, bounds.height, display);
  return {
    x: work.x + Math.round((work.width - size.width) / 2),
    y: work.y + 10,
    width: size.width,
    height: size.height,
  };
}

function syncPanelOpenState(): void {
  safeWriteStdin(keyListenerProcess, panelMode === 'presented' ? 'PANEL_OPEN\n' : 'PANEL_CLOSED\n', 'key_listener');
}

function broadcastPanelMode(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('panel-mode', panelMode);
  }
}

function getNativeHwnd(win: BrowserWindow): string {
  const buf = win.getNativeWindowHandle();
  if (buf.length >= 8) {
    return buf.readBigUInt64LE(0).toString();
  }
  return buf.readUInt32LE(0).toString();
}

function compactPillBackgroundColor(): string {
  return WIN32_OPAQUE_PILL ? PILL_BG_COLOR : '#00000000';
}

function presentedPanelBackgroundColor(): string {
  return WIN32_OPAQUE_PILL ? PANEL_BG_COLOR : '#00000000';
}

function ensurePillMouseInput(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(false);
}

function syncCompactPillLayer(): void {
  if (!mainWindow || mainWindow.isDestroyed() || panelMode !== 'compact') return;
  const shouldBeAlwaysOnTop = selectionActive || transientPillActive;
  if (shouldBeAlwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, COMPACT_PILL_LEVEL, COMPACT_PILL_RELATIVE);
  } else {
    mainWindow.setAlwaysOnTop(false);
  }
  ensurePillMouseInput();
}

/** Compact pill: CSS capsule only. HWND clip + DWM tweaks break mouse input on Windows. */
function applyWindowShape(mode: 'compact' | 'presented'): void {
  if (mode === 'compact') {
    syncCompactPillLayer();
    return;
  }
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const exe = path.join(__dirname, 'round_window.exe');
  if (!fs.existsSync(exe)) return;

  const hwnd = getNativeHwnd(mainWindow);

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setBackgroundColor(PANEL_BG_COLOR);
    for (const mode of ['panel', 'clear']) {
      const helper = spawn(exe, [hwnd, mode], { windowsHide: true });
      helper.once('error', (error) => {
        console.warn(`round_window ${mode} failed:`, error);
      });
    }
  }, 16);
}

function applyPanelBounds(bounds: Electron.Rectangle, mode: 'compact' | 'presented'): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(false);
  if (mode === 'compact') {
    const pill = clampPillBounds(bounds);
    compactPillSize = { width: pill.width, height: pill.height };
    mainWindow.setBackgroundColor(compactPillBackgroundColor());
    mainWindow.webContents.send('pill-resized', compactPillSize);
    mainWindow.setBounds(pill);
    mainWindow.setMinimumSize(PILL_MIN.width, PILL_MIN.height);
    mainWindow.setMaximumSize(PILL_MAX.width, PILL_MAX.height);
    applyWindowShape('compact');
    return;
  }
  mainWindow.setBackgroundColor(presentedPanelBackgroundColor());
  const panel = clampPresentedBounds(bounds);
  mainWindow.setResizable(true);
  mainWindow.setMaximumSize(10000, 10000);
  mainWindow.setMinimumSize(1, 1);
  mainWindow.setBounds(panel);
  mainWindow.setMinimumSize(panel.width, panel.height);
  mainWindow.setMaximumSize(panel.width, panel.height);
  mainWindow.setResizable(false);
  applyWindowShape('presented');
}

function mainPagePath(page: 'pill' | 'panel'): string {
  const file = page === 'pill' ? 'pill.html' : 'index.html';
  return path.join(app.getAppPath(), file);
}

function clearTransientPillTimer(): void {
  if (transientPillTimer) {
    clearTimeout(transientPillTimer);
    transientPillTimer = null;
  }
}

function compactPillShouldBeVisible(): boolean {
  return shouldShowCompactPill(normalizePillVisibility(settings.pillVisibility), { selectionActive, transientActive: transientPillActive });
}

function applyCompactPillVisibility(): void {
  if (panelMode !== 'compact' || shutdownStarted) return;
  if (useNativePillHud) {
    syncNativePillHud();
    return;
  }
  if (!isWindowUsable(mainWindow) || mainWindowPage !== 'pill') return;
  if (compactPillShouldBeVisible()) {
    mainWindow.show();
    syncCompactPillLayer();
  } else {
    mainWindow.hide();
  }
}

function activateTransientPill(): void {
  transientPillActive = true;
  clearTransientPillTimer();
  applyCompactPillVisibility();
  transientPillTimer = setTimeout(() => {
    transientPillTimer = null;
    transientPillActive = false;
    applyCompactPillVisibility();
  }, 4500);
}

function loadMainWindowPage(page: 'pill' | 'panel'): Promise<boolean> {
  if (!isWindowUsable(mainWindow)) return Promise.resolve(false);
  if (useNativePillHud && page === 'pill') return Promise.resolve(true);
  
  const win = mainWindow;
  if (mainWindowPageLoad?.window === win && mainWindowPageLoad.page === page) {
    return mainWindowPageLoad.promise;
  }
  if (mainWindowPage === page && !mainWindowPageLoad) return Promise.resolve(true);
  
  const generation = ++mainWindowPageLoadGeneration;
  mainWindowPage = page;
  
  const promise = win
    .loadFile(mainPagePath(page))
    .then(() => 
      mainWindow === win &&
      isWindowUsable(win) &&
      mainWindowPageLoadGeneration === generation &&
      mainWindowPage === page
    )
    .catch((error) => {
      if (mainWindow === win && mainWindowPageLoadGeneration === generation) {
        mainWindowPage = 'none';
        console.error(`${page} page load failed:`, error);
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
}

function presentSpotlight(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (panelMode === 'presented') {
    mainWindow.focus();
    return;
  }
  if (useNativePillHud) {
    sendPillHudCommand('HIDE');
  } else {
    savedPillBounds = clampPillBounds(mainWindow.getBounds());
    settings.panelX = savedPillBounds.x;
    settings.panelY = savedPillBounds.y;
  }
  panelMode = 'presented';
  const panelBounds = spotlightCenterBounds();
  applyPanelBounds(panelBounds, 'presented');
  mainWindow.setAlwaysOnTop(true);
  broadcastPanelMode();
  void loadMainWindowPage('panel').then(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    applyPanelBounds(panelBounds, 'presented');
    mainWindow.show();
    mainWindow.focus();
    syncPanelOpenState();
    broadcastPanelMode();
  });
}

function dismissSpotlight(force = false): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (panelMode === 'compact') return;
  if (!force && settings.panelPinned) return;
  panelMode = 'compact';
  mainWindow.hide();
  mainWindow.setAlwaysOnTop(false);
  if (useNativePillHud) {
    syncNativePillHud();
    syncPanelOpenState();
    broadcastPanelMode();
    return;
  }
  const pill = savedPillBounds ?? getInitialPanelBounds();
  void loadMainWindowPage('pill').then(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    applyPanelBounds(pill, 'compact');
    syncPanelOpenState();
    broadcastPanelMode();
  });
}

/** Spotlight-style HUD: pill stays visible above the capture overlay for live status. */
function setHudCapturing(active: boolean): void {
  if (useNativePillHud && panelMode === 'compact') {
    sendPillHudCommand(`CAPTURE:${active ? 1 : 0}`);
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindowPage === 'pill') {
    mainWindow.webContents.send('hud-capturing', active);
  }
}

function hidePillForScreenshot(): void {
  if (panelMode === 'presented' && !settings.panelPinned) {
    dismissSpotlight();
    return;
  }
  if (useNativePillHud) {
    sendPillHudCommand('HIDE');
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (panelMode === 'compact') {
    savedPillBounds = clampPillBounds(mainWindow.getBounds());
  }
  mainWindow.hide();
}

function showPillHudOverOverlay(): void {
  panelMode = 'compact';
  if (useNativePillHud) {
    syncNativePillHud();
    pillHudElevated = true;
    setHudCapturing(true);
    broadcastPanelMode();
    syncPanelOpenState();
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void loadMainWindowPage('pill').then(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    applyPanelBounds(
      clampPillBounds(savedPillBounds ?? getInitialPanelBounds()),
      'compact'
    );
    mainWindow.setAlwaysOnTop(true, PILL_HUD_LEVEL, PILL_HUD_RELATIVE);
    pillHudElevated = true;
    mainWindow.show();
    setHudCapturing(true);
    broadcastPanelMode();
    syncPanelOpenState();
  });
}

function restorePillHudLayer(): void {
  setHudCapturing(false);
  if (pillHudElevated) {
    pillHudElevated = false;
  }
  if (panelMode === 'compact' || settings.panelPinned) {
    if (useNativePillHud) {
      syncNativePillHud();
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    syncCompactPillLayer();
  }
}

function toggleSpotlight(): void {
  if (panelMode === 'presented') {
    dismissSpotlight();
  } else {
    presentSpotlight();
  }
}

function resizeCompactPill(requestedWidth: number, requestedHeight: number): void {
  if (panelMode !== 'compact') return;
  if (useNativePillHud) {
    const next = clampCompactSize(requestedWidth, requestedHeight);
    if (next.width === compactPillSize.width && next.height === compactPillSize.height) return;
    compactPillSize = next;
    sendPillHudCommand(`SIZE:${next.width}:${next.height}`);
    return;
  }
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindowPage !== 'pill'
  ) {
    return;
  }
  const prev = mainWindow.getBounds();
  const display = screen.getDisplayMatching(prev);
  const next = clampCompactSize(requestedWidth, requestedHeight, display);
  if (next.width === compactPillSize.width && next.height === compactPillSize.height) return;

  compactPillSize = next;
  const pill = clampPillBounds({
    x: prev.x,
    y: prev.y,
    width: next.width,
    height: next.height,
  });
  mainWindow.setBackgroundColor(compactPillBackgroundColor());
  mainWindow.webContents.send('pill-resized', next);
  mainWindow.setBounds(pill);
  applyWindowShape('compact');
}

function persistPanelPosition(): void {
  if (useNativePillHud || !mainWindow || mainWindow.isDestroyed()) return;
  if (panelMode !== 'compact') return;
  const bounds = clampPillBounds(mainWindow.getBounds());
  settings.panelX = bounds.x;
  settings.panelY = bounds.y;
  savedPillBounds = bounds;
  settingsStore.save();
}

function createMainWindow(): void {
  useNativePillHud = resolveNativePillHud();
  const initialBounds = getInitialPanelBounds();
  panelMode = 'compact';
  const startBounds = ensurePillOnScreen(initialBounds);
  savedPillBounds = startBounds;
  compactPillSize = { width: startBounds.width, height: startBounds.height };

  const panelSize = panelWindowSize();
  mainWindow = new BrowserWindow({
    x: useNativePillHud ? -20000 : startBounds.x,
    y: useNativePillHud ? -20000 : startBounds.y,
    width: useNativePillHud ? panelSize.width : startBounds.width,
    height: useNativePillHud ? panelSize.height : startBounds.height,
    minWidth: useNativePillHud ? panelSize.width : PILL_MIN.width,
    maxWidth: useNativePillHud ? panelSize.width : PILL_MAX.width,
    minHeight: useNativePillHud ? panelSize.height : PILL_MIN.height,
    maxHeight: useNativePillHud ? panelSize.height : PILL_MAX.height,
    frame: false,
    transparent: useNativePillHud ? false : !WIN32_OPAQUE_PILL,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: useNativePillHud ? presentedPanelBackgroundColor() : compactPillBackgroundColor(),
    title: '',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!useNativePillHud) {
    mainWindow.on('moved', persistPanelPosition);
  }

  // Spotlight: presented panel dismisses on outside click — never during capture/HUD.
  mainWindow.on('blur', () => {
    setTimeout(() => {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.isFocused() &&
        panelMode === 'presented' &&
        !settings.panelPinned &&
        !selectionActive &&
        !selectionStarting &&
        !pillHudElevated
      ) {
        dismissSpotlight();
      }
    }, 220);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    broadcastPanelMode();
    if (
      !useNativePillHud &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindowPage === 'pill' &&
      panelMode === 'compact'
    ) {
      applyWindowShape('compact');
      applyCompactPillVisibility();
    }
    if (settings.panelPinned && panelMode !== 'presented') {
      presentSpotlight();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (
      !useNativePillHud &&
      panelMode === 'compact' &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindowPage === 'pill'
    ) {
      applyCompactPillVisibility();
    }
  });

  if (useNativePillHud) {
    mainWindowPage = 'none';
    startNativePillHud();
    console.log('Windows native pill HUD aktif (pill_hud.exe)');
  } else {
    mainWindowPage = 'pill';
    mainWindow.loadFile(mainPagePath('pill')).then(() => {
      if (panelMode === 'compact') {
        applyCompactPillVisibility();
      }
    }).catch(err => console.error('Pill page load failed:', err));
  }
}

function getVirtualBounds(): Rect {
  return computeVirtualBounds(screen.getAllDisplays());
}

function invalidateOverlayLifecycle(): void {
  clearPendingRenderWaiter();
  overlayGeneration += 1;
  if (overlayLifecycle) {
    overlayLifecycle.resolveRendererReady();
    overlayLifecycle = null;
  }
}

function ensureOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayLifecycle) {
    return overlayWindow;
  }

  invalidateOverlayLifecycle();
  const generation = overlayGeneration;
  const bounds = getVirtualBounds();

  overlayWindow = new BrowserWindow({
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  let resolveLoad!: () => void;
  const loadPromise = new Promise<void>((resolve) => {
    resolveLoad = resolve;
  });

  let resolveReady!: () => void;
  const rendererReadyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  overlayLifecycle = {
    window: overlayWindow,
    generation,
    loadPromise,
    rendererReadyPromise,
    resolveRendererReady: resolveReady,
    rendererReady: false,
  };

  overlayWindow.webContents.once('did-finish-load', () => {
    resolveLoad();
  });

  overlayWindow.loadFile(path.join(app.getAppPath(), 'src', 'overlay.html')).catch((err) => {
    console.error('Failed to load overlay html:', err);
  });

  return overlayWindow;
}

async function waitForOverlayReady(lifecycle: NonNullable<typeof overlayLifecycle>): Promise<void> {
  await lifecycle.loadPromise;
  if (lifecycle.generation !== overlayGeneration || !isWindowUsable(lifecycle.window)) {
    throw new Error('Overlay generation changed during load');
  }
  await withTimeout(lifecycle.rendererReadyPromise, 2500, 'Overlay renderer initialization handshake timed out');
  if (lifecycle.generation !== overlayGeneration || !isWindowUsable(lifecycle.window)) {
    throw new Error('Overlay generation changed during handshake');
  }
}

function createGeminiWindow(): BrowserWindow {
  if (geminiWindow && !geminiWindow.isDestroyed()) {
    return geminiWindow;
  }

  geminiWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    backgroundColor: '#0b0f14',
    title: 'Gemini Web',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:gemini',
    },
  });

  geminiWindow.on('close', (event) => {
    if (!shutdownStarted) {
      event.preventDefault();
      geminiWindow?.hide();
    }
  });

  geminiWindow.on('closed', () => {
    geminiWindow = null;
  });

  return geminiWindow;
}

async function ensureGeminiWindowLoaded(): Promise<BrowserWindow> {
  const win = createGeminiWindow();
  const url = win.webContents.getURL();
  if (!url || url === 'about:blank') {
    await win.loadURL(geminiUrl);
  }
  return win;
}

async function openGeminiWindow(): Promise<BrowserWindow> {
  const win = await ensureGeminiWindowLoaded();
  win.show();
  win.focus();
  return win;
}

async function focusGeminiComposer(
  windowInstance: BrowserWindow,
  promptText: string
): Promise<boolean> {
  const safePrompt = JSON.stringify(promptText);
  const focused = await windowInstance.webContents.executeJavaScript(`
    (() => {
      const selectors = ['div[contenteditable="true"]', 'div[role="textbox"]', 'textarea', 'input[type="text"]'];
      const element = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
      if (element) {
        element.focus();
        element.click();
        
        const prompt = ${safePrompt};
        if (prompt) {
          if (element.tagName === 'DIV' || element.getAttribute('contenteditable') === 'true') {
            element.innerText = prompt;
          } else {
            element.value = prompt;
          }
          // Dispatch events so the React engine registers the change and enables Send button
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
      return false;
    })();
  `);

  return Boolean(focused);
}

function sendPasteShortcut(windowInstance: BrowserWindow): void {
  windowInstance.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['ctrl'] });
  windowInstance.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['ctrl'] });
}

// NOTE: status/response strings pushed from the main process (capture, AI, OCR,
// Supabase, phone-sync flows) are currently Turkish-only. The renderer shows them
// verbatim, so under an English UI these runtime lines stay Turkish. Static labels
// and the settings-screen actions ARE localized (see src/lib/i18n.ts); localizing
// the ~30 main-process call sites is a tracked low-priority follow-up that would
// touch the core capture path.
function setStatus(message: string): void {
  const oneLine = message.replace(/\r?\n/g, ' ').trim();
  if (useNativePillHud && panelMode === 'compact') {
    sendPillHudCommand(`STATUS:${oneLine}`);
    sendPillHudCommand('ACTIVE');
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    const sendToRenderer =
      (mainWindowPage === 'panel' && panelMode === 'presented') ||
      (mainWindowPage === 'pill' && panelMode === 'compact');
    if (sendToRenderer) {
      mainWindow.webContents.send('status', oneLine);
    }
  }
  // Whenever a status message arrives and we're not mid-selection,
  // briefly surface the compact pill so the user sees the feedback.
  if (!selectionActive && !selectionStarting && panelMode === 'compact') {
    activateTransientPill();
  }
}

function setResponse(message: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('response', message);
  }
}

function sendOverlayState(state: any): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-state', state);
  }
}

async function showSelectionOverlay(backgroundImagePath: string, bounds: Rect, sessionId: number): Promise<void> {
  const win = ensureOverlayWindow();
  if (!isWindowUsable(win)) return;

  const currentGeneration = overlayGeneration;
  const lifecycle = overlayLifecycle;

  const windowPort = {
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => {
      if (isWindowUsable(win)) {
        win.setIgnoreMouseEvents(ignore, options);
      }
    },
    setBounds: (b: Rect) => {
      if (isWindowUsable(win)) {
        win.setBounds(b);
      }
    },
    sendOverlayState: (state: any) => {
      sendOverlayState(state);
    },
    showInactive: () => {
      if (isWindowUsable(win)) {
        win.showInactive();
      }
    },
  };

  const isCurrent = () => {
    return (
      isWindowUsable(win) &&
      overlayLifecycle === lifecycle &&
      overlayGeneration === currentGeneration &&
      selectionActive &&
      isSelectionSessionCurrent(sessionId)
    );
  };

  const waitForReady = async () => {
    if (lifecycle && lifecycle.window === win) {
      await waitForOverlayReady(lifecycle);
    }
  };

  let activeRenderPromise: Promise<void> | null = null;

  const prepareRenderWaiter = (sessId: number) => {
    if (pendingRenderWaiter) {
      pendingRenderWaiter.reject(new Error('Superseeded by new render waiter'));
      pendingRenderWaiter = null;
    }
    const renderPromise = new Promise<void>((resolve, reject) => {
      pendingRenderWaiter = {
        sessionId: sessId,
        generation: currentGeneration,
        resolve,
        reject,
      };
    });
    activeRenderPromise = withTimeout(renderPromise, 2500, 'Overlay session render acknowledgement timed out');
  };

  const waitForRendered = async () => {
    if (activeRenderPromise) {
      await activeRenderPromise;
    } else {
      throw new Error('Render waiter was not prepared');
    }
  };

  await activateSelectionOverlay({
    windowPort,
    bounds,
    selectionRect,
    backgroundImagePath,
    sessionId,
    waitForReady,
    prepareRenderWaiter,
    waitForRendered,
    isCurrent,
  });
}

function hideSelectionOverlay(sessionId: number): void {
  clearPendingRenderWaiter();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    sendOverlayState({ visible: false, active: false, selection: null, backgroundImage: null, sessionId });
    overlayWindow.hide();
  }
  restorePillHudLayer();
  applyCompactPillVisibility();
}

function setSelectionInstruction(message: string, sessionId: number): void {
  if (overlayWindow && !overlayWindow.isDestroyed() && isSelectionSessionCurrent(sessionId)) {
    overlayWindow.webContents.send('overlay-message', message);
  }
}

function resetSelectionSession(sessionId: number): void {
  if (sessionId !== selectionSessionId) return;
  selectionActive = false;
  selectionDragEnabled = false;
  selectionHasAnnotations = false;
  selectionRect = null;
  selectionDisplay = null;
  capturedScreenImage = null;
  safeWriteStdin(keyListenerProcess, 'INACTIVE\n', 'key_listener');
}

function isSelectionSessionCurrent(sessionId: number): boolean {
  return selectionSessionId === sessionId && !shutdownStarted;
}

function deleteSelectionDragFile(filePath: string | null): void {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && (err as any).code !== 'ENOENT') {
      console.warn('Failed to delete temporary drag file:', err);
    }
  });
}

function getSelectionDragDirectory(): string {
  return path.join(app.getPath('temp'), 'ctrl2phone-drag');
}

function cleanupStaleSelectionDragFiles(): void {
  const dragDir = getSelectionDragDirectory();
  const oldestAllowed = Date.now() - 10 * 60_000;
  try {
    if (!fs.existsSync(dragDir)) return;
    for (const entry of fs.readdirSync(dragDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(drag-|capture-).*\.png$/i.test(entry.name)) continue;
      const filePath = path.join(dragDir, entry.name);
      try {
        if (fs.statSync(filePath).mtimeMs < oldestAllowed) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.warn('Selection drag temp cleanup failed:', error);
  }
}

function invalidateSelectionDragAsset(): void {
  selectionDragGeneration += 1;
  const stalePath = currentSelectionDragFilePath;
  currentSelectionDragFilePath = null;
  if (stalePath) {
    deleteSelectionDragFile(stalePath);
  }
}

interface SelectionSnapshot {
  sessionId: number;
  image: Electron.NativeImage;
  rect: Rect;
  display: Display;
  hasAnnotations: boolean;
}

function currentSelectionSnapshot(sessionId: number): SelectionSnapshot | null {
  if (!selectionActive || !capturedScreenImage || !selectionRect || !selectionDisplay || selectionSessionId !== sessionId) {
    return null;
  }
  return {
    sessionId,
    image: capturedScreenImage,
    rect: selectionRect,
    display: selectionDisplay,
    hasAnnotations: selectionHasAnnotations,
  };
}

function beginSelectionAction(sessionId: number): number | null {
  if (!isSelectionSessionCurrent(sessionId)) return null;
  selectionActionInFlightSessionId = sessionId;
  return sessionId;
}

function endSelectionAction(actionSessionId: number | null): void {
  if (actionSessionId === selectionActionInFlightSessionId) {
    selectionActionInFlightSessionId = null;
  }
}

async function startSelectionSession(): Promise<void> {
  if (selectionStarting || selectionActive) {
    return;
  }
  selectionStarting = true;
  const sessionId = ++selectionSessionId;
  selectionSessionStartTime = Date.now();
  selectionDragEnabled = true;
  invalidateSelectionDragAsset();
  setHudCapturing(true);
  applyCompactPillVisibility();
  
  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    selectionDisplay = activeDisplay;

    hidePillForScreenshot();
    
    const tScreenshotStart = Date.now();
    const availableDisplays = await screenshot.listDisplays();
    const captureDisplay = selectExternalCaptureDisplay(availableDisplays, activeDisplay);
    if (!captureDisplay) {
      throw new Error(`Active display could not be mapped for capture: ${activeDisplay.id}`);
    }
    const imageBuffer = await screenshot({ format: 'png', screen: captureDisplay.id });
    const tScreenshotEnd = Date.now();
    console.log(`[PERF] [t1] Screenshot hazır (external display capture). Süre: ${tScreenshotEnd - tScreenshotStart}ms. Toplam süre: ${tScreenshotEnd - selectionSessionStartTime}ms`);
    
    if (!isSelectionSessionCurrent(sessionId) || shutdownStarted) return;
    
    capturedScreenImage = nativeImage.createFromBuffer(imageBuffer);
    if (capturedScreenImage.isEmpty()) {
      throw new Error('Captured screen image is empty');
    }
    const previewBase64 = capturedScreenImage.toJPEG(82).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${previewBase64}`;

    selectionActive = true;
    safeWriteStdin(keyListenerProcess, 'ACTIVE\n', 'key_listener');
    selectionRect = null;

    const tShowOverlayStart = Date.now();
    await showSelectionOverlay(dataUrl, activeDisplay.bounds, sessionId);
    const tShowOverlayEnd = Date.now();
    console.log(`[PERF] [t2] showSelectionOverlay bitti. Süre: ${tShowOverlayEnd - tShowOverlayStart}ms. Toplam süre: ${tShowOverlayEnd - selectionSessionStartTime}ms`);
    
    if (!isSelectionSessionCurrent(sessionId) || shutdownStarted) return;
    
    showPillHudOverOverlay();
    setSelectionInstruction(
      'Alanı seç → X/Enter: Gemini · M: Telefon · C: OCR · Esc: iptal',
      sessionId
    );
    setStatus('Seçim modu açık. Alanı fareyle çiz.');
  } catch (error: any) {
    console.error('Ekran yakalama hatası:', error);
    setStatus('Ekran yakalama başlatılamadı: ' + error.message);
    setHudCapturing(false);
    restorePillHudLayer();
    if (isSelectionSessionCurrent(sessionId)) {
      hideSelectionOverlay(sessionId);
      resetSelectionSession(sessionId);
    }
  } finally {
    if (selectionSessionId === sessionId) {
      selectionStarting = false;
    }
  }
}

function toAbsoluteRect(rect: Rect, displayBounds: Rect): Rect {
  return computeAbsoluteRect(rect, displayBounds);
}

function cropImageToSelection(
  image: Electron.NativeImage,
  rect: Rect,
  display: Display
): Electron.NativeImage {
  const relative = computeCropRect(rect, display.bounds, image.getSize(), display.scaleFactor);
  return image.crop(relative);
}

async function getAnnotatedComposite(snapshot: SelectionSnapshot): Promise<Electron.NativeImage | null> {
  if (!snapshot.hasAnnotations || !isSelectionSessionCurrent(snapshot.sessionId) || !overlayWindow || overlayWindow.isDestroyed()) {
    return null;
  }
  try {
    const dataUrl = await overlayWindow.webContents.executeJavaScript(
      'window.__ctrl2phoneCompose ? window.__ctrl2phoneCompose() : null'
    );
    if (!isSelectionSessionCurrent(snapshot.sessionId)) return null;
    if (dataUrl && typeof dataUrl === 'string') {
      const img = nativeImage.createFromDataURL(dataUrl);
      if (!img.isEmpty()) {
        return img;
      }
    }
  } catch (e) {
    console.error('Annotation composite failed; using plain crop:', e);
  }
  return null;
}

async function resolveSelectionImage(snapshot: SelectionSnapshot): Promise<Electron.NativeImage | null> {
  const absoluteRect = toAbsoluteRect(snapshot.rect, snapshot.display.bounds);
  const clampedRect = clampRectToDisplay(absoluteRect, snapshot.display.bounds);
  if (clampedRect.width <= 0 || clampedRect.height <= 0) return null;
  const annotatedImage = await getAnnotatedComposite(snapshot);
  if (!isSelectionSessionCurrent(snapshot.sessionId)) return null;
  return annotatedImage ?? cropImageToSelection(snapshot.image, clampedRect, snapshot.display);
}

async function updateSelectionDragAsset(sessionId: number): Promise<void> {
  if (!selectionDragEnabled) {
    return;
  }
  const snapshot = currentSelectionSnapshot(sessionId);
  if (!snapshot) {
    invalidateSelectionDragAsset();
    return;
  }
  const generation = ++selectionDragGeneration;
  try {
    const image = await resolveSelectionImage(snapshot);
    if (!image || isImageEmptySafe(image) || !isSelectionSessionCurrent(sessionId) || selectionDragGeneration !== generation || !selectionDragEnabled) {
      return;
    }
    
    const dragDir = getSelectionDragDirectory();
    if (!fs.existsSync(dragDir)) {
      fs.mkdirSync(dragDir, { recursive: true });
    }
    
    const dragFilePath = path.join(dragDir, `drag-${sessionId}-${generation}.png`);
    fs.writeFileSync(dragFilePath, image.toPNG());
    
    if (!isSelectionSessionCurrent(sessionId) || selectionDragGeneration !== generation) {
      deleteSelectionDragFile(dragFilePath);
      return;
    }
    
    const oldPath = currentSelectionDragFilePath;
    currentSelectionDragFilePath = dragFilePath;
    deleteSelectionDragFile(oldPath);
    sendSelectionDragState(sessionId, true);
  } catch (err) {
    console.error('Failed to update selection drag asset:', err);
  }
}

function isImageEmptySafe(img: Electron.NativeImage): boolean {
  try {
    return img.isEmpty();
  } catch {
    return true;
  }
}

// Candidate locations for a bundled native helper exe. process.resourcesPath
// (where electron-builder's extraResources land) must be checked first so the
// packaged build finds the exe; the later entries cover dev / npm start.
function helperExeCandidates(name: string): string[] {
  return [
    path.join(process.resourcesPath, 'src', name),
    path.join(process.resourcesPath, name),
    path.join(__dirname, name),
    path.join(__dirname, '..', 'src', name),
    path.join(app.getAppPath(), 'src', name),
  ];
}

function resolveNativePillHud(): boolean {
  // Always return false to use the HTML5/Electron compact pill HUD
  // so we can support drop-to-upload and drag-to-download folder features.
  return false;
}

function getPillHudPath(): string {
  for (const p of helperExeCandidates('pill_hud.exe')) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('pill_hud.exe not found');
}

function sendPillHudCommand(command: string): void {
  safeWriteStdin(pillHudProcess, command + '\n', 'pill_hud');
}

function clearPillHudReadyTimer(): void {
  if (pillHudReadyTimer) {
    clearTimeout(pillHudReadyTimer);
    pillHudReadyTimer = null;
  }
}

function activateElectronPillFallback(): void {
  if (nativeHudDisabledForRun || shutdownStarted) return;
  console.warn('Native pill HUD failed to respond/start. Falling back to Electron compact pill HUD...');
  nativeHudDisabledForRun = true;
  useNativePillHud = false;
  stopNativePillHud();
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindowPage = 'pill';
    mainWindow.setBackgroundColor(compactPillBackgroundColor());
    
    let resolveFallback!: () => void;
    _pillHudFallbackInFlight = new Promise<void>((resolve) => {
      resolveFallback = resolve;
    });
    
    mainWindow.loadFile(mainPagePath('pill'))
      .then(() => {
        applyCompactPillVisibility();
      })
      .catch((err) => console.error('Electron pill fallback file load failed:', err))
      .finally(() => {
        _pillHudFallbackInFlight = null;
        resolveFallback();
      });
  }
}

function syncNativePillHud(message?: string): void {
  if (!useNativePillHud || shutdownStarted) return;
  const bounds = ensurePillOnScreen(savedPillBounds ?? getInitialPanelBounds());
  savedPillBounds = bounds;
  compactPillSize = { width: bounds.width, height: bounds.height };
  sendPillHudCommand(`MAXW:${pillMaxWidthForDisplay()}`);
  sendPillHudCommand(`POS:${bounds.x}:${bounds.y}`);
  sendPillHudCommand(`SIZE:${bounds.width}:${bounds.height}`);
  if (message) {
    sendPillHudCommand(`STATUS:&status=${encodeURIComponent(message)}`);
  }
  
  const visible = compactPillShouldBeVisible();
  sendPillHudCommand(visible ? 'SHOW' : 'HIDE');
}

function handlePillHudEvent(line: string): void {
  if (line === 'PILL_READY') {
    clearPillHudReadyTimer();
    const ready = selectionActive
      ? 'Seçim modu açık'
      : getStrings(resolveLang(settings.language, app.getLocale()))['status.ready'] ?? 'Hazır';
    syncNativePillHud(ready);
    return;
  }
  if (line === 'PILL_TOGGLE') {
    toggleSpotlight();
    return;
  }
  if (line.startsWith('PILL_MOVED:')) {
    const parts = line.split(':');
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const bounds = ensurePillOnScreen({
      x: Math.round(x),
      y: Math.round(y),
      width: compactPillSize.width,
      height: compactPillSize.height,
    });
    savedPillBounds = bounds;
    settings.panelX = bounds.x;
    settings.panelY = bounds.y;
    settingsStore.save();
    return;
  }
  if (line.startsWith('PILL_RESIZED:')) {
    const parts = line.split(':');
    const width = Number(parts[1]);
    const height = Number(parts[2]);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      const display = savedPillBounds ? screen.getDisplayMatching(savedPillBounds) : undefined;
      compactPillSize = clampCompactSize(width, height, display);
      if (savedPillBounds) {
        savedPillBounds = ensurePillOnScreen({
          ...savedPillBounds,
          width: compactPillSize.width,
          height: compactPillSize.height,
        });
        settings.panelX = savedPillBounds.x;
        settings.panelY = savedPillBounds.y;
        settingsStore.save();
        sendPillHudCommand(`POS:${savedPillBounds.x}:${savedPillBounds.y}`);
      }
    }
  }
}

function stopNativePillHud(): void {
  const proc = pillHudProcess;
  if (!proc) return;
  
  clearPillHudReadyTimer();
  intentionallyStoppedPillHuds.add(proc);
  pillHudProcess = null;
  
  try {
    proc.stdin?.end();
  } catch {
    // ignore
  }
  try {
    proc.kill();
  } catch {
    // ignore
  }
}

function startNativePillHud(): void {
  if (!useNativePillHud || shutdownStarted) return;
  stopNativePillHud();
  clearPillHudReadyTimer();
  
  try {
    const binaryPath = getPillHudPath();
    const proc = spawn(binaryPath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    pillHudProcess = proc;
    
    attachStdinErrorGuard(proc, 'pill_hud');
    bindLineReader(proc.stdout, (line) => {
      if (pillHudProcess === proc) handlePillHudEvent(line);
    });
    
    proc.stderr?.on('data', (chunk: Buffer) => {
      console.warn('[pill_hud stderr]:', chunk.toString('utf8').trim());
    });
    
    proc.on('error', (err: Error) => {
      console.error('Native pill HUD process failed:', err);
      if (pillHudProcess === proc) {
        activateElectronPillFallback();
      }
    });
    
    proc.on('exit', (code, signal) => {
      console.log(`Native pill HUD exited with code ${code}, signal ${signal}`);
      if (pillHudProcess === proc) {
        pillHudProcess = null;
        if (!intentionallyStoppedPillHuds.has(proc) && !shutdownStarted) {
          activateElectronPillFallback();
        }
      }
    });
    
    pillHudReadyTimer = setTimeout(() => {
      pillHudReadyTimer = null;
      if (pillHudProcess === proc) {
        console.warn('Native pill HUD did not signal PILL_READY in 4.5s');
        activateElectronPillFallback();
      }
    }, 4500);
  } catch (err) {
    console.error('Native pill HUD başlatılamadı:', err);
    activateElectronPillFallback();
  }
}

function getKeyListenerPath(): string {
  const possiblePaths = helperExeCandidates('key_listener.exe');
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `key_listener.exe not found at paths: ${possiblePaths.join(', ')}. Run: csc /nologo /reference:System.Windows.Forms.dll /target:exe /out:key_listener.exe key_listener.cs`
  );
}

// Photo dropper helper is no longer used since incoming downloads are directly
// displayed inside the folder list in the Electron compact pill HUD.


function startKeyListener(): void {
  try {
    stopKeyListener();

    const binaryPath = getKeyListenerPath();
    const proc = spawn(binaryPath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    keyListenerProcess = proc;

    attachStdinErrorGuard(proc, 'key_listener');
    bindLineReader(proc.stdout, (line) => {
      if (keyListenerProcess === proc) handleGlobalKeyEvent(line);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error('[key_listener stderr]', data.toString().trim());
    });

    proc.on('error', (err: Error) => {
      console.error('Key listener process error:', err);
      if (keyListenerProcess === proc) setStatus('Klavye dinleyici başlatılamadı');
    });

    proc.on('exit', (code, signal) => {
      console.error(`key_listener exited with code ${code}, signal ${signal}`);
      if (keyListenerProcess === proc) {
        keyListenerProcess = null;
        if (code !== 0 && code !== null && !shutdownStarted) {
          setStatus('Klavye dinleyici kapandı — kısayollar çalışmıyor');
        }
      }
    });

    // Push the current hotkey config to the freshly-spawned listener.
    sendKeyListenerConfig();

    setStatus('Klavye dinleyici başlatılıyor...');
  } catch (err) {
    console.error('Failed to spawn key listener:', err);
    setStatus('Klavye dinleyici başlatılamadı');
  }
}

// Tell the C# listener which key to watch for and the double-press window.
function sendKeyListenerConfig(): void {
  const vk = settings.hotkeyVk || 0xa2;
  const ms = settings.doublePressMs || 400;
  safeWriteStdin(keyListenerProcess, `CONFIG:${vk}:${ms}\n`, 'key_listener');
}

function stopKeyListener(): void {
  const proc = keyListenerProcess;
  if (!proc) return;
  keyListenerProcess = null;
  try {
    proc.stdin?.end();
  } catch {
    // ignore
  }
  try {
    proc.kill();
  } catch {
    // ignore — process may already be gone
  }
}

function handleGlobalKeyEvent(event: string): void {
  if (event === 'READY') {
    console.log('[main.ts] Keyboard hook registered successfully by key_listener.exe');
    setStatus('Çift Ctrl ile seçim modu hazır');
    return;
  }
  if (event === 'HOOK_FAILED') {
    console.error('[main.ts] Keyboard hook registration failed in key_listener.exe');
    setStatus('Klavye kancası takılamadı (Sistem engellemiş olabilir)');
    return;
  }
  if (event === 'DOUBLE_CTRL') {
    if (!selectionActive) {
      void startSelectionSession();
    }
  } else if (event === 'KEY_X' || event === 'KEY_RETURN') {
    if (selectionActive) {
      if (!selectionRect) {
        setStatus('Önce fareyle bir alan seç.');
        return;
      }
      void captureAndSend(selectionSessionId);
    }
  } else if (event === 'KEY_M') {
    if (selectionActive) {
      if (!selectionRect) {
        setStatus('Önce fareyle bir alan seç.');
        return;
      }
      void captureAndSendToSupabase(selectionSessionId);
    }
  } else if (event === 'KEY_C') {
    if (selectionActive) {
      if (!selectionRect) {
        setStatus('Önce fareyle bir alan seç.');
        return;
      }
      console.log('KEY_C → OCR başlatılıyor');
      void captureAndOcr(selectionSessionId);
    }
  } else if (event === 'CTRL_SHIFT_V') {
    void sendClipboardToPhone();
  } else if (event === 'CTRL_SHIFT_SPACE') {
    toggleSpotlight();
  } else if (event === 'SPOTLIGHT_DISMISS') {
    dismissSpotlight();
  } else if (event === 'KEY_ESCAPE') {
    if (selectionActive) {
      const sid = selectionSessionId;
      hideSelectionOverlay(sid);
      resetSelectionSession(sid);
      setStatus('Seçim iptal edildi');
    }
  } else if (event === 'KEY_Q') {
    // Q quits the app — only forwarded by the key listener while selection is
    // active, so it never fires while the user is typing in a window.
    if (selectionActive) {
      const sid = selectionSessionId;
      hideSelectionOverlay(sid);
      resetSelectionSession(sid);
    }
    quitApplication();
  }
}

async function captureAndSend(sessionId: number): Promise<void> {
  const snapshot = currentSelectionSnapshot(sessionId);
  if (!snapshot) return;
  const actionSessionId = beginSelectionAction(sessionId);
  if (actionSessionId === null) return;
  try {
    const croppedImage = await resolveSelectionImage(snapshot);
    if (!croppedImage || !isSelectionSessionCurrent(sessionId)) {
      return;
    }
    
    hideSelectionOverlay(sessionId);
    resetSelectionSession(sessionId);
    
    clipboard.writeImage(croppedImage);
    
    if (isApiProviderConfigured()) {
      await analyzeWithApi(croppedImage, () => isSelectionSessionCurrent(sessionId) || actionSessionId === selectionActionInFlightSessionId);
      return;
    }
    
    const windowInstance = await openGeminiWindow();
    if (!isSelectionSessionCurrent(sessionId) && actionSessionId !== selectionActionInFlightSessionId) return;
    
    const composerFocused = await focusGeminiComposer(windowInstance, settings.prompt);
    sendPasteShortcut(windowInstance);
    
    setResponse(
      `Seçilen alan Gemini web'e kopyalandı. ${composerFocused ? 'Yapıştırma denendi.' : 'Yapıştırma kısayolu gönderildi.'}`
    );
    setStatus("Seçilen görsel Gemini web'e yapıştırıldı");
    
    activateTransientPill();
  } catch (error: any) {
    if (isSelectionSessionCurrent(sessionId) || actionSessionId === selectionActionInFlightSessionId) {
      setResponse(`Hata: ${error.message}`);
      setStatus('Seçim veya yapıştırma sırasında hata');
      hideSelectionOverlay(sessionId);
      resetSelectionSession(sessionId);
    }
  } finally {
    endSelectionAction(actionSessionId);
  }
}

function isApiProviderConfigured(): boolean {
  if (settings.aiProvider === 'web') return false;
  if (settings.aiProvider === 'custom') return Boolean(settings.aiBaseUrl.trim());
  return Boolean(settings.aiApiKey.trim());
}

async function analyzeWithApi(image: Electron.NativeImage, isCurrent: () => boolean): Promise<boolean> {
  const provider = settings.aiProvider;
  const config = {
    provider: provider as AiProvider,
    apiKey: settings.aiApiKey,
    model: settings.aiModel,
    baseUrl: settings.aiBaseUrl,
  };
  const prompt = settings.prompt;
  setStatus('Yapay zeka analiz ediyor...');
  setResponse('Analiz ediliyor... (yanıt birazdan burada görünecek)');
  
  try {
    const pngBase64 = image.toPNG().toString('base64');
    const text = await analyzeImage(config, pngBase64, prompt);
    if (!isCurrent()) return false;
    
    setResponse(text);
    setStatus(`Yanıt alındı (${provider})`);
    activateTransientPill();
    return true;
  } catch (error: any) {
    if (isCurrent()) {
      setResponse(`Yapay zeka hatası: ${error.message}`);
      setStatus('Yapay zeka isteği başarısız');
      activateTransientPill();
    }
    return false;
  }
}

async function captureAndOcr(sessionId: number): Promise<void> {
  if (ocrInFlight) {
    setStatus('OCR zaten çalışıyor, lütfen bekleyin...');
    return;
  }
  const snapshot = currentSelectionSnapshot(sessionId);
  if (!snapshot) return;
  const actionSessionId = beginSelectionAction(sessionId);
  if (actionSessionId === null) return;
  ocrInFlight = true;
  
  try {
    const croppedImage = await resolveSelectionImage(snapshot);
    if (!croppedImage || !isSelectionSessionCurrent(sessionId)) {
      return;
    }
    const pngBuffer = croppedImage.toPNG();
    
    hideSelectionOverlay(sessionId);
    resetSelectionSession(sessionId);
    guardLocalClipboard(45000);
    setStatus('Metin okunuyor (OCR)...');
    setResponse('OCR çalışıyor... (bitince otomatik panoya kopyalanacak)');
    
    const aiConfig =
      settings.aiProvider !== 'web'
        ? {
            provider: settings.aiProvider as AiProvider,
            apiKey: settings.aiApiKey,
            model: settings.aiModel,
            baseUrl: settings.aiBaseUrl,
          }
        : null;

    const { text, source } = await extractTextFromImage(pngBuffer, { aiConfig });
    if (actionSessionId !== selectionActionInFlightSessionId && !isSelectionSessionCurrent(sessionId)) {
      return;
    }

    if (!text.trim()) {
      setResponse('Seçilen alanda okunabilir metin bulunamadı.');
      setStatus('OCR tamamlandı - metin yok');
      activateTransientPill();
      return;
    }

    const copied = await writeTextToClipboardReliable(text);
    const preview = text.length > 500 ? text.substring(0, 500) + '...' : text;
    setResponse(preview);

    if (copied) {
      setStatus(
        source === 'windows'
          ? 'Metin panoya kopyalandı (Windows OCR) - Ctrl+V ile yapıştır'
          : `Metin panoya kopyalandı (${settings.aiProvider} OCR) - Ctrl+V ile yapıştır`
      );
    } else {
      setStatus('OCR metni üretildi ama panoya yazılamadı - metni response alanından kopyalayın');
      setResponse(`${preview}\n\n⚠️ Panoya otomatik kopyalanamadı. Yukarıdaki metni elle seçip kopyalayın.`);
    }
    activateTransientPill();
  } catch (error: any) {
    if (isSelectionSessionCurrent(sessionId) || actionSessionId === selectionActionInFlightSessionId) {
      console.error('OCR error:', error);
      setResponse(`OCR hatası: ${error.message}`);
      setStatus('Metin okunamadı');
      hideSelectionOverlay(sessionId);
      resetSelectionSession(sessionId);
      activateTransientPill();
    }
  } finally {
    ocrInFlight = false;
    endSelectionAction(actionSessionId);
  }
}

async function captureAndSendToSupabase(sessionId: number): Promise<boolean> {
  const snapshot = currentSelectionSnapshot(sessionId);
  if (!snapshot) return false;
  
  const context = getSupabaseContext();
  if (!context) {
    setStatus('Supabase ayarları eksik! Lütfen ayarlardan doldurun.');
    setResponse('Hata: Supabase URL veya Anon Key tanımlanmamış. Ayarları kontrol edin.');
    hideSelectionOverlay(sessionId);
    resetSelectionSession(sessionId);
    activateTransientPill();
    return false;
  }
  
  const actionSessionId = beginSelectionAction(sessionId);
  if (actionSessionId === null) return false;
  
  try {
    const croppedImage = await resolveSelectionImage(snapshot);
    if (!croppedImage || !isSelectionSessionCurrent(sessionId)) {
      return false;
    }
    const pngBuffer = croppedImage.toPNG();
    
    hideSelectionOverlay(sessionId);
    resetSelectionSession(sessionId);
    setStatus("Görsel Supabase'e yükleniyor...");
    
    const fileName = `screenshot_${randomUUID()}.png`;
    const { error } = await context.client.storage.from(context.bucket).upload(fileName, pngBuffer, {
      contentType: 'image/png',
      upsert: true,
    });
    
    if (actionSessionId !== selectionActionInFlightSessionId && !isSelectionSessionCurrent(sessionId)) {
      return false;
    }
    if (!isSupabaseContextCurrent(context)) {
      throw new Error('Supabase ayarları yükleme sırasında değişti');
    }
    if (error) {
      throw new Error(`Supabase upload hatası: ${error.message}`);
    }

    let shareUrl = '';
    try {
      const { data: signed } = await context.client.storage
        .from(context.bucket)
        .createSignedUrl(fileName, 60 * 60 * 24 * 7); // 7 gün geçerli
      shareUrl = signed?.signedUrl ?? '';
    } catch {
      // ignore
    }

    if (actionSessionId !== selectionActionInFlightSessionId && !isSelectionSessionCurrent(sessionId)) {
      return false;
    }
    
    setResponse(
      shareUrl
        ? `Supabase'e başarıyla yüklendi!\nGörsel Adresi (7 gün geçerli):\n${shareUrl}`
        : "Supabase'e başarıyla yüklendi! Telefon uygulamasından görüntüleyebilirsin."
    );
    setStatus('Seçilen görsel telefona gönderildi (Supabase)');
    activateTransientPill();
    return true;
  } catch (error: any) {
    if (isSelectionSessionCurrent(sessionId) || actionSessionId === selectionActionInFlightSessionId) {
      console.error('Supabase upload error:', error);
      setResponse(`Hata: ${error.message}`);
      setStatus('Supabase yükleme hatası');
      hideSelectionOverlay(sessionId);
      resetSelectionSession(sessionId);
      activateTransientPill();
    }
    return false;
  } finally {
    endSelectionAction(actionSessionId);
  }
}



ipcMain.handle('save-settings', (_, nextSettings: Partial<AppSettings>) => {
  if (shutdownStarted) return { ok: false };
  const result = settingsStore.update(nextSettings);

  if (result.pillVisibilityChanged) {
    applyCompactPillVisibility();
  }
  if (result.supabaseChanged) {
    supabaseRuntime.invalidate();
  }

  sendKeyListenerConfig();
  settingsStore.save();
  setupPhoneSyncPolling();
  setupClipboardPolling();
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-changed', settings);
  }
  return { ok: true };
});



ipcMain.handle('copy-selection', async (event, sessionId: number) => {
  const ports: CopySelectionPorts<Electron.NativeImage> = {
    isSenderAuthorized: () => {
      return overlayWindow !== null && !overlayWindow.isDestroyed() && event.sender === overlayWindow.webContents;
    },
    isSessionCurrent: () => {
      return isSelectionSessionCurrent(sessionId);
    },
    getSelectionImage: async () => {
      const snapshot = currentSelectionSnapshot(sessionId);
      if (!snapshot) return null;
      return await resolveSelectionImage(snapshot);
    },
    writeImageToClipboard: (image) => {
      clipboard.writeImage(image);
    },
    readImageFromClipboard: () => {
      return clipboard.readImage();
    },
    setStatus: (msg: string) => {
      setStatus(msg);
    },
    onSuccess: () => {
      invalidateSelectionDragAsset();
      hideSelectionOverlay(sessionId);
      resetSelectionSession(sessionId);
    },
  };
  return await executeCopySelection(ports);
});

ipcMain.handle('set-selection', (_, payload: any) => {
  if (!selectionActive || payload?.sessionId !== selectionSessionId) {
    return { ok: false };
  }

  if (payload?.type === 'start') {
    invalidateSelectionDragAsset();
    selectionRect = null;
    return { ok: true };
  }

  if (payload?.type === 'update') {
    const rect = payload.rect as Rect;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      invalidateSelectionDragAsset();
      selectionRect = null;
      selectionDisplay = null;
      return { ok: true };
    }

    invalidateSelectionDragAsset();
    selectionRect = rect;
    // The overlay covers exactly one display, so renderer coordinates are local
    // to the display selected when the capture session started.
    selectionDisplay ??= screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    hidePillForScreenshot();
    if (selectionDragEnabled) {
      void updateSelectionDragAsset(payload.sessionId);
    }
    return { ok: true };
  }

  return { ok: false };
});

ipcMain.handle('cancel-selection', (_, sessionId: number) => {
  if (!selectionActive || sessionId !== selectionSessionId) return { ok: false };
  hideSelectionOverlay(sessionId);
  resetSelectionSession(sessionId);
  setStatus('Seçim iptal edildi');
  return { ok: true };
});

ipcMain.handle('set-annotated', (_, payload: any) => {
  if (!selectionActive || payload?.sessionId !== selectionSessionId) return { ok: false };
  invalidateSelectionDragAsset();
  selectionHasAnnotations = Boolean(payload.hasAnnotations);
  if (selectionDragEnabled) {
    void updateSelectionDragAsset(payload.sessionId);
  }
  return { ok: true };
});

ipcMain.handle('confirm-selection-gemini', async (_, sessionId: number) => {
  if (selectionActive && selectionRect && sessionId === selectionSessionId) {
    await captureAndSend(sessionId);
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('confirm-selection-phone', async (_, sessionId: number) => {
  if (selectionActive && selectionRect && sessionId === selectionSessionId) {
    await captureAndSendToSupabase(sessionId);
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('confirm-selection-ocr', async (_, sessionId: number) => {
  if (selectionActive && selectionRect && sessionId === selectionSessionId) {
    await captureAndOcr(sessionId);
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('get-storage-usage', async () => {
  const context = getSupabaseContext();
  if (!context) {
    return { ok: false, error: 'Supabase client not initialized' };
  }
  if (storagePurgeInFlightGeneration === context.generation) {
    return { ok: false, error: 'Storage purge in progress' };
  }
  try {
    const { data: files, error } = await context.client.storage.from(context.bucket).list('', {
      limit: 1000,
    });
    if (error) throw error;
    if (!isSupabaseContextCurrent(context)) {
      throw new Error('Supabase configuration changed during storage query');
    }

    let totalBytes = 0;
    if (files) {
      for (const f of files) {
        if (f.name !== 'to_pc' && f.metadata && f.metadata.size) {
          totalBytes += f.metadata.size;
        }
      }
    }

    let toPcFiles: any[] = [];
    try {
      const { data: toPc, error: toPcError } = await context.client.storage
        .from(context.bucket)
        .list('to_pc', {
          limit: 1000,
        });
      if (!toPcError && toPc) toPcFiles = toPc;
    } catch {
      // ignore
    }
    
    if (!isSupabaseContextCurrent(context)) {
      throw new Error('Supabase configuration changed during storage query');
    }

    for (const f of toPcFiles) {
      if (f.metadata && f.metadata.size) {
        totalBytes += f.metadata.size;
      }
    }

    const limitBytes = 1024 * 1024 * 1024; // 1 GB
    return {
      ok: true,
      usedBytes: totalBytes,
      limitBytes: limitBytes,
      usedPercentage: (totalBytes / limitBytes) * 100,
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('purge-storage', async () => {
  const context = getSupabaseContext();
  if (!context) {
    return { ok: false, error: 'Supabase client not initialized' };
  }
  if (storagePurgeInFlightGeneration === context.generation) {
    return { ok: false, error: 'Storage purge already in progress' };
  }
  storagePurgeInFlightGeneration = context.generation;
  
  try {
    const { data: rootFiles, error: rootError } = await context.client.storage
      .from(context.bucket)
      .list('', {
        limit: 1000,
      });
    if (rootError) throw rootError;
    if (!isSupabaseContextCurrent(context)) {
      throw new Error('Supabase configuration changed during storage purge');
    }

    const filesToDelete: string[] = [];
    if (rootFiles) {
      for (const f of rootFiles) {
        if (f.name !== 'to_pc' && f.name !== '.keep' && !f.name.startsWith('.')) {
          filesToDelete.push(f.name);
        }
      }
    }

    let toPcFiles: any[] = [];
    try {
      const { data: toPc, error: toPcError } = await context.client.storage
        .from(context.bucket)
        .list('to_pc', {
          limit: 1000,
        });
      if (!toPcError && toPc) toPcFiles = toPc;
    } catch {
      // ignore
    }
    
    if (!isSupabaseContextCurrent(context)) {
      throw new Error('Supabase configuration changed during storage purge');
    }

    for (const f of toPcFiles) {
      if (f.name !== '.keep' && !f.name.startsWith('.')) {
        filesToDelete.push(`to_pc/${f.name}`);
      }
    }

    if (filesToDelete.length > 0) {
      const { error: removeError } = await context.client.storage
        .from(context.bucket)
        .remove(filesToDelete);
      if (removeError) throw removeError;
    }

    return { ok: true, deletedCount: filesToDelete.length };
  } catch (err: any) {
    return { ok: false, error: err.message };
  } finally {
    if (storagePurgeInFlightGeneration === context.generation) {
      storagePurgeInFlightGeneration = null;
    }
  }
});

// ── Auto-updater ────────────────────────────────────────────────────────────
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});
autoUpdater.on('update-available', () => {
  console.log('Update available.');
});
autoUpdater.on('update-not-available', () => {
  console.log('Update not available.');
});
autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater:', err);
});
autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded; will install on quit');
});

// Last-resort safety net so a stray rejection never tears the app down silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

ipcMain.handle('app-ready', () => {
  if (shutdownStarted) {
    return {
      prompt: settings.prompt,
      supabaseUrl: settings.supabaseUrl,
      supabaseKey: settings.supabaseKey,
      supabaseBucket: settings.supabaseBucket,
      autoCopyFromPhone: settings.autoCopyFromPhone,
      hotkeyVk: settings.hotkeyVk,
      doublePressMs: settings.doublePressMs,
      aiProvider: settings.aiProvider,
      aiApiKey: settings.aiApiKey,
      aiModel: settings.aiModel,
      aiBaseUrl: settings.aiBaseUrl,
      language: settings.language,
      panelPinned: settings.panelPinned ?? false,
      panelMode,
      pillMaxWidth: pillMaxWidthForDisplay(),
      i18n: getStrings(resolveLang(settings.language, app.getLocale())),
      selectionActive: false,
    };
  }
  return {
    prompt: settings.prompt,
    supabaseUrl: settings.supabaseUrl,
    supabaseKey: settings.supabaseKey,
    supabaseBucket: settings.supabaseBucket,
    autoCopyFromPhone: settings.autoCopyFromPhone,
    hotkeyVk: settings.hotkeyVk,
    doublePressMs: settings.doublePressMs,
    aiProvider: settings.aiProvider,
    aiApiKey: settings.aiApiKey,
    aiModel: settings.aiModel,
    aiBaseUrl: settings.aiBaseUrl,
    language: settings.language,
    panelPinned: settings.panelPinned ?? false,
    panelMode,
    pillMaxWidth: pillMaxWidthForDisplay(),
    i18n: getStrings(resolveLang(settings.language, app.getLocale())),
    selectionActive,
    pillVisibility: normalizePillVisibility(settings.pillVisibility),
    phoneDownloads: downloadedPhoneFiles.map(filePath => {
      const name = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext);
      return {
        path: filePath,
        name,
        isImage,
      };
    }),
  };
});

ipcMain.handle('panel-interact-start', () => {
  if (shutdownStarted) return { ok: false };
  syncCompactPillLayer();
  if (mainWindow && !mainWindow.isDestroyed() && panelMode === 'compact') {
    mainWindow.focus();
  }
  return { ok: true };
});

ipcMain.handle('panel-toggle', () => {
  if (shutdownStarted) return { ok: false };
  toggleSpotlight();
  return { ok: true, mode: panelMode };
});

ipcMain.handle('panel-drag-by', (_, dx: number, dy: number) => {
  if (!isWindowUsable(mainWindow) || panelMode !== 'compact' || shutdownStarted) {
    return { ok: false };
  }
  const deltaX = Math.round(Number(dx));
  const deltaY = Math.round(Number(dy));
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) {
    return { ok: false };
  }
  const bounds = clampPillBounds({
    x: mainWindow.getBounds().x + deltaX,
    y: mainWindow.getBounds().y + deltaY,
    width: compactPillSize.width,
    height: compactPillSize.height,
  });
  mainWindow.setPosition(bounds.x, bounds.y);
  return { ok: true };
});

ipcMain.handle('panel-dismiss', () => {
  if (shutdownStarted) return { ok: false };
  dismissSpotlight(true);
  return { ok: true, mode: panelMode };
});

ipcMain.handle('panel-resize-compact', (_, size: { width?: number; height?: number }) => {
  if (shutdownStarted) return { ok: false };
  const width = typeof size?.width === 'number' ? size.width : PILL_DEFAULT.width;
  const height = typeof size?.height === 'number' ? size.height : PILL_DEFAULT.height;
  resizeCompactPill(width, height);
  return { ok: true, width: compactPillSize.width, height: compactPillSize.height };
});

ipcMain.handle('panel-save-pinned', (_, pinned: boolean) => {
  if (shutdownStarted) return { ok: false };
  settings.panelPinned = Boolean(pinned);
  settingsStore.save();
  if (pinned) {
    presentSpotlight();
  } else {
    dismissSpotlight();
  }
  return { ok: true };
});

ipcMain.handle('send-clipboard', async () => {
  if (shutdownStarted) return { ok: false };
  return sendClipboardToPhone();
});

ipcMain.handle('generate-qr', async () => {
  if (shutdownStarted) return { ok: false };
  try {
    if (!settings.supabaseUrl || !settings.supabaseKey) {
      return { ok: false, error: 'Supabase ayarları eksik' };
    }
    const data = JSON.stringify({
      url: settings.supabaseUrl,
      key: settings.supabaseKey,
      bucket: settings.supabaseBucket || 'screenshots',
    });
    const dataUrl = await QRCode.toDataURL(data);
    return { ok: true, dataUrl };
  } catch (error: any) {
    console.error('QR Kod oluşturma hatası:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('setup-rls', async () => {
  if (shutdownStarted) return { ok: false };
  try {
    const bucket = settings.supabaseBucket || 'screenshots';
    const sql = buildRlsSetupSql(bucket);
    await writeTextToClipboardReliable(sql);
    
    let projectRef = '_';
    if (settings.supabaseUrl) {
      const match = settings.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/i);
      if (match) {
        projectRef = match[1];
      }
    }

    await shell.openExternal(`https://supabase.com/dashboard/project/${projectRef}/sql/new`);
    return { ok: true, sql };
  } catch (error: any) {
    console.error('RLS kurulum hatası:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('open-gemini', async () => {
  if (shutdownStarted) return { ok: false };
  const windowInstance = await openGeminiWindow();
  return { ok: Boolean(windowInstance) };
});

ipcMain.handle('focus-gemini', async () => {
  if (shutdownStarted) return { ok: false };
  const windowInstance = await openGeminiWindow();
  return { ok: Boolean(windowInstance) };
});

ipcMain.handle('capture-now', async () => {
  if (shutdownStarted) return { ok: false };
  if (!selectionActive) {
    void startSelectionSession();
    return { ok: true, mode: 'selection-opened' };
  }
  void captureAndSend(selectionSessionId);
  return { ok: true };
});

ipcMain.handle('overlay-renderer-ready', (event) => {
  if (overlayWindow && event.sender === overlayWindow.webContents) {
    const lifecycle = overlayLifecycle;
    if (lifecycle && lifecycle.window === overlayWindow) {
      lifecycle.rendererReady = true;
      lifecycle.resolveRendererReady();
    }
  }
  return { ok: true };
});

ipcMain.handle('overlay-rendered', (event, sessionId: number) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents) return { ok: false };
  if (!isSelectionSessionCurrent(sessionId)) return { ok: false };
  if (pendingRenderWaiter) {
    if (
      pendingRenderWaiter.sessionId === sessionId &&
      pendingRenderWaiter.generation === overlayGeneration
    ) {
      pendingRenderWaiter.resolve();
      pendingRenderWaiter = null;
      console.log(`[PERF] [t3] Renderer rendered selection overlay for sessionId: ${sessionId}. Toplam süre: ${Date.now() - selectionSessionStartTime}ms`);
      return { ok: true };
    }
  }
  return { ok: false };
});

ipcMain.handle('app-quit', () => {
  quitApplication();
  return { ok: true };
});

ipcMain.on('start-selection-drag', (event, sessionId: number) => {
  const win = overlayWindow;
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
  if (!isSelectionSessionCurrent(sessionId)) return;

  const result = executeSelectionElectronDrag({
    getAsset: () => {
      const filePath = currentSelectionDragFilePath;
      if (!filePath || !fs.existsSync(filePath)) return null;
      const sourceIcon = nativeImage.createFromPath(filePath);
      if (sourceIcon.isEmpty()) return null;
      const previewSize = calculateDragPreviewSize(sourceIcon.getSize(), {
        width: 160,
        height: 120,
      });
      const icon = sourceIcon.resize({ ...previewSize, quality: 'good' });
      return { file: filePath, icon };
    },
    getOverlayBounds: () => win.getBounds(),
    prepareOverlay: () => {
      currentSelectionDragFilePath = null;
      selectionDragGeneration += 1;
      selectionDragEnabled = false;
      win.setIgnoreMouseEvents(true, { forward: true });
      sendOverlayState({
        visible: false,
        active: false,
        selection: null,
        backgroundImage: null,
        sessionId,
      });
      win.setAlwaysOnTop(false);
      win.setBounds({ x: -32000, y: -32000, width: 1, height: 1 });
      win.blur();
    },
    startDrag: (asset) => {
      event.sender.startDrag(asset);
    },
    restoreOverlayBounds: (bounds) => {
      if (!win.isDestroyed()) {
        win.setBounds(bounds);
        win.setAlwaysOnTop(true, 'screen-saver');
      }
    },
    finishSelection: (filePath) => {
      hideSelectionOverlay(sessionId);
      resetSelectionSession(sessionId);
      setStatus('Sürükle-bırak tamamlandı');
      const fileTimer = setTimeout(() => {
        deleteSelectionDragFile(filePath);
      }, 5 * 60_000);
      fileTimer.unref();
    },
    reportError: (message) => {
      console.error('Selection startDrag failed:', message);
      setStatus(`Sürükle-bırak başlatılamadı: ${message}`);
    },
  });

  if (!result.ok) {
    console.warn('Selection drag was not started:', result.error);
  }
});

async function uploadFileToPhone(filePath: string): Promise<boolean> {
  const context = getSupabaseContext();
  if (!context) {
    setStatus('Supabase ayarları eksik! Lütfen ayarlardan doldurun.');
    activateTransientPill();
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

    setStatus('Dosya Supabase\'e yükleniyor...');
    const { error } = await context.client.storage.from(context.bucket).upload(fileName, fileBuffer, {
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
        : 'Telefona başarıyla yüklendi! Telefon uygulamasından görüntüleyebilirsin.'
    );
    setStatus('Dosya telefona gönderildi');
    activateTransientPill();
    return true;
  } catch (error: unknown) {
    console.error('Failed to upload file to phone:', error);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Yükleme başarısız: ${message}`);
    activateTransientPill();
    return false;
  }
}

function isMainWindowSender(sender: WebContents): boolean {
  return isWindowUsable(mainWindow) && sender === mainWindow.webContents;
}

function resolveMainWindowDownload(sender: WebContents, requestedPath: unknown): string | null {
  if (!isMainWindowSender(sender)) return null;
  return resolveApprovedDownloadedFile(requestedPath, downloadedPhoneFiles);
}

ipcMain.handle('upload-file-to-phone', async (event, filePath: unknown) => {
  if (shutdownStarted || !isMainWindowSender(event.sender) || typeof filePath !== 'string') {
    return { ok: false };
  }
  const ok = await uploadFileToPhone(filePath);
  return { ok };
});

ipcMain.on('start-drag-downloaded-file', (event, requestedPath: unknown) => {
  if (shutdownStarted) return;
  const filePath = resolveMainWindowDownload(event.sender, requestedPath);
  if (!filePath) return;
  console.log('[main.ts] start-drag-downloaded-file:', filePath);
  let icon = nativeImage.createFromPath(filePath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]));
  } else {
    const size = icon.getSize();
    const maxDim = 150;
    if (size.width > maxDim || size.height > maxDim) {
      const scale = Math.min(maxDim / size.width, maxDim / size.height);
      icon = icon.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'good'
      });
    }
  }
  try {
    event.sender.startDrag({
      file: filePath,
      icon: icon,
    });
  } catch (error) {
    console.error('startDrag for downloaded file failed:', error);
  }
});

ipcMain.handle('delete-downloaded-file', async (event, requestedPath: unknown) => {
  if (shutdownStarted) return { ok: false };
  const filePath = resolveMainWindowDownload(event.sender, requestedPath);
  if (!filePath) return { ok: false };

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    console.error('Failed to delete downloaded phone file:', error);
    return { ok: false };
  }

  downloadedPhoneFiles = downloadedPhoneFiles.filter(p => p !== filePath);
  broadcastPhoneDownloads();
  return { ok: true };
});

function clearNotificationTimers(): void {
  if (notificationDismissTimer) {
    clearTimeout(notificationDismissTimer);
    notificationDismissTimer = null;
  }
  if (notificationCloseTimer) {
    clearTimeout(notificationCloseTimer);
    notificationCloseTimer = null;
  }
}

function displayNotification(win: BrowserWindow, generation: number, payload: { title: string; body: string; type: string }): void {
  win.webContents.send('notification-data', payload);
  
  if (notificationDismissTimer) clearTimeout(notificationDismissTimer);
  notificationDismissTimer = setTimeout(() => {
    notificationDismissTimer = null;
    if (notificationWindow === win && notificationGeneration === generation && !shutdownStarted) {
      win.webContents.send('notification-dismiss');
      
      if (notificationCloseTimer) clearTimeout(notificationCloseTimer);
      notificationCloseTimer = setTimeout(() => {
        notificationCloseTimer = null;
        if (notificationWindow === win && notificationGeneration === generation && !shutdownStarted) {
          win.hide();
        }
      }, 500);
    }
  }, 3500);
}

function showCustomNotification(
  title: string,
  body: string,
  type: 'success' | 'info' | 'error' | 'sync' = 'info'
): void {
  if (shutdownStarted) return;
  
  const payload = { title, body, type };
  if (!notificationWindow || notificationWindow.isDestroyed()) {
    pendingNotification = payload;
    
    const work = screen.getPrimaryDisplay().workArea;
    const width = 360;
    const height = 90;
    
    notificationWindow = new BrowserWindow({
      x: work.x + work.width - width - 16,
      y: work.y + 16,
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    
    notificationWindow.setAlwaysOnTop(true, 'screen-saver');
    
    const generation = ++notificationGeneration;
    
    notificationWindow.webContents.once('did-finish-load', () => {
      notificationRendererReady = true;
      if (notificationWindow === notificationWindow && notificationGeneration === generation && pendingNotification && !shutdownStarted) {
        const toDisplay = pendingNotification;
        pendingNotification = null;
        notificationWindow!.show();
        displayNotification(notificationWindow!, generation, toDisplay);
      }
    });
    
    notificationWindow.loadFile(path.join(app.getAppPath(), 'src', 'notification.html')).catch((err) => {
      console.error('Failed to load notification file:', err);
    });
    
    notificationWindow.on('closed', () => {
      if (notificationWindow === notificationWindow) {
        notificationWindow = null;
        notificationRendererReady = false;
      }
    });
    
    return;
  }
  
  const generation = ++notificationGeneration;
  clearNotificationTimers();
  
  if (notificationRendererReady && !notificationWindow.isDestroyed() && !shutdownStarted) {
    pendingNotification = null;
    notificationWindow.show();
    displayNotification(notificationWindow!, generation, payload);
  } else {
    pendingNotification = payload;
  }
}

// ── Auto-updater ────────────────────────────────────────────────────────────
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
});
autoUpdater.on('update-available', () => {
  console.log('Update available.');
});
autoUpdater.on('update-not-available', () => {
  console.log('Update not available.');
});
autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater:', err);
});
autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded; will install on quit');
});

// Last-resort safety net so a stray rejection never tears the app down silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!shutdownStarted) {
      if (isWindowUsable(mainWindow)) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  app.whenReady().then(() => {
    settingsStore.load();
    phoneSyncState.load();
    settingsStore.migrateLegacyPillVisibility();

    createMainWindow();
    
    try {
      startKeyListener();
    } catch (err) {
      console.error('Klavye dinleyici başlatılamadı:', err);
      setStatus('Klavye dinleyici bulunamadı (key_listener.exe derlenmemiş olabilir).');
    }
    
    cleanupStaleSelectionDragFiles();
    setupPhoneSyncPolling();
    setupClipboardPolling();

    setTimeout(() => {
      if (!shutdownStarted) {
        ensureGeminiWindowLoaded().catch((e) => console.error('Gemini ön-yükleme hatası:', e));
      }
    }, 5000);

    const isPacked = app.isPackaged;
    const forceDevUpdate = false;
    
    if (isPacked || forceDevUpdate) {
      autoUpdater
        .checkForUpdatesAndNotify()
        .catch((e) => console.error('Güncelleme kontrolü başarısız:', e));
    } else {
      console.log('Skip checkForUpdates because application is not packed and dev update config is not forced');
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  if (beginShutdown()) {
    // Let the asynchronous teardown process complete
  }
});

app.on('will-quit', () => {
  // Teardown is fully handled in beginShutdown
  if (_pillHudFallbackInFlight) { /* ignore */ }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
