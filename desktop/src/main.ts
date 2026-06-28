import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  safeStorage,
  screen,
  shell,
  Display,
} from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import screenshot from 'screenshot-desktop';
import QRCode from 'qrcode';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { autoUpdater } from 'electron-updater';
import Tesseract from 'tesseract.js';
import { AppSettings, Rect } from './types';
import {
  getVirtualBounds as computeVirtualBounds,
  toAbsoluteRect as computeAbsoluteRect,
  clampRectToDisplay,
  computeCropRect,
} from './lib/geometry';
import { buildRlsSetupSql } from './lib/supabaseSetup';
import { analyzeImage, AiProvider } from './lib/aiProviders';
import { resolveLang, getStrings } from './lib/i18n';

// GPU acceleration is enabled (required for native startDrag to work on Windows)

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let geminiWindow: BrowserWindow | null = null;
let selectionActive = false;
let selectionStarting = false;
let selectionHasAnnotations = false;
let selectionRect: Rect | null = null;
let selectionDisplay: Display | null = null;
let capturedScreenImage: Electron.NativeImage | null = null;
let keyListenerProcess: ChildProcess | null = null;
let supabaseClient: SupabaseClient | null = null;
let supabaseClientUrl = '';
let phoneSyncInFlight = false;

const settings: AppSettings = {
  prompt: 'Bu ekran görüntüsünü analiz et ve kısa bir özet ver.',
  supabaseUrl: '',
  supabaseKey: '',
  supabaseBucket: 'screenshots',
  autoCopyFromPhone: true,
  hotkeyVk: 0xa2, // Left Ctrl
  doublePressMs: 400,
  aiProvider: 'web',
  aiApiKey: '',
  aiModel: '',
  aiBaseUrl: '',
  language: 'system',
};

const geminiUrl = 'https://gemini.google.com/app';

let settingsPath: string | undefined;
let phoneSyncInterval: NodeJS.Timeout | null = null;
let phoneSyncChannel: RealtimeChannel | null = null;

function stopPhoneSyncPolling(): void {
  if (phoneSyncInterval) {
    clearInterval(phoneSyncInterval);
    phoneSyncInterval = null;
  }
  if (phoneSyncChannel) {
    try {
      supabaseClient?.removeChannel(phoneSyncChannel);
    } catch {
      // ignore teardown errors
    }
    phoneSyncChannel = null;
  }
}

// Lazily (re)create the Supabase client when settings are present. Returns null
// if Supabase is not configured yet.
function ensureSupabaseClient(): SupabaseClient | null {
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    return null;
  }
  if (!supabaseClient || supabaseClientUrl !== settings.supabaseUrl) {
    supabaseClient = createClient(settings.supabaseUrl, settings.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    supabaseClientUrl = settings.supabaseUrl;
  }
  return supabaseClient;
}

async function checkPhoneSync(): Promise<void> {
  if (!settings.autoCopyFromPhone) {
    return;
  }

  if (!settings.supabaseUrl || !settings.supabaseKey) {
    return;
  }

  // Skip if a previous poll is still running (slow network) to avoid overlap.
  if (phoneSyncInFlight) {
    return;
  }
  phoneSyncInFlight = true;

  try {
    if (!supabaseClient || supabaseClientUrl !== settings.supabaseUrl) {
      supabaseClient = createClient(settings.supabaseUrl, settings.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      supabaseClientUrl = settings.supabaseUrl;
    }

    const bucket = settings.supabaseBucket || 'screenshots';
    const { data: files, error } = await supabaseClient.storage.from(bucket).list('to_pc', {
      limit: 10,
      sortBy: { column: 'created_at', order: 'asc' },
    });

    if (error) {
      // Log error but don't spam if it's a persistent connection issue
      console.warn('Phone sync list error:', error.message);
      return;
    }

    if (!files || files.length === 0) {
      return;
    }

    const downloadedLocalPaths: string[] = [];

    for (const file of files) {
      if (!file.name || file.name === '.keep' || file.name.startsWith('.')) {
        continue;
      }

      const filePath = `to_pc/${file.name}`;

      const { data: fileBlob, error: downloadError } = await supabaseClient.storage
        .from(bucket)
        .download(filePath);

      if (downloadError) {
        console.error(`Phone sync: failed to download ${filePath}:`, downloadError);
        continue;
      }

      const arrayBuffer = await fileBlob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const image = nativeImage.createFromBuffer(buffer);

      if (!image.isEmpty()) {
        clipboard.writeImage(image);

        // Save incoming photo locally for Native Drag-and-Drop
        const parts = file.name.split('.');
        const extension = parts[parts.length - 1] || 'png';

        const tempDir = path.join(app.getPath('temp'), 'ctrl2phone');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        const cleanFileName = `phone_${Date.now()}_${downloadedLocalPaths.length}.${extension}`;
        const localFilePath = path.join(tempDir, cleanFileName);
        fs.writeFileSync(localFilePath, buffer);

        downloadedLocalPaths.push(localFilePath);

        // Ack-after-success: only remove the remote file once it is safely copied
        // to the clipboard + saved locally, so a failure leaves it for retry.
        const { error: deleteError } = await supabaseClient.storage.from(bucket).remove([filePath]);
        if (deleteError) {
          console.error(`Phone sync: failed to delete ${filePath}:`, deleteError);
        }
      } else {
        console.error('Phone sync: downloaded file is not a valid image (kept for retry)');
      }
    }

    if (downloadedLocalPaths.length > 0) {
      // Launch Spotlight-style floating photo dropper C# executable with all paths
      const dropperPath = getPhotoDropperPath();
      if (dropperPath) {
        spawn(dropperPath, downloadedLocalPaths, {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } else {
        console.error('[Phone Sync] photo_dropper.exe not found in any known location');
      }

      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const count = downloadedLocalPaths.length;
        const notification = new Notification({
          title: count > 1 ? 'Telefondan Görseller Alındı' : 'Telefondan Görsel Alındı',
          body:
            count > 1
              ? `${count} adet fotoğraf paneli açıldı! Sürükle-bırak kullanabilirsiniz.`
              : 'Fotoğraf paneli açıldı! Sürükle-bırak kullanabilirsiniz.',
          silent: false,
        });
        notification.show();
      }

      setStatus(
        downloadedLocalPaths.length > 1
          ? `${downloadedLocalPaths.length} görsel telefondan alındı`
          : 'Görsel telefondan alındı'
      );
      setResponse(
        `${downloadedLocalPaths.length} adet görsel telefondan alındı ve sürükle-bırak paneli açıldı.`
      );
    }
  } catch (err: any) {
    console.error('Error in checkPhoneSync:', err);
  } finally {
    phoneSyncInFlight = false;
  }
}

function setupPhoneSyncPolling(): void {
  stopPhoneSyncPolling();

  if (!settings.autoCopyFromPhone) {
    console.log('Phone sync: disabled by settings');
    return;
  }

  const client = ensureSupabaseClient();
  if (!client) {
    console.log('Phone sync: waiting for Supabase settings');
    return;
  }

  const bucket = settings.supabaseBucket || 'screenshots';

  // Realtime push: react instantly when the phone uploads into to_pc/. Requires
  // the one-time setup SQL (storage.objects in the realtime publication + anon
  // SELECT policy). If unavailable, the slow fallback poll below still works.
  phoneSyncChannel = client
    .channel('ctrl2phone-to-pc')
    .on(
      'postgres_changes',
      // bucket_id == bucket name for user-created Supabase buckets.
      { event: 'INSERT', schema: 'storage', table: 'objects', filter: `bucket_id=eq.${bucket}` },
      (payload: { new?: { name?: string } }) => {
        const name = payload?.new?.name ?? '';
        if (name.startsWith('to_pc/')) {
          checkPhoneSync();
        }
      }
    )
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        // Catch anything that arrived while we were disconnected.
        checkPhoneSync();
      }
    });

  // Safety-net poll, far slower than the old 4s, so sync still works even when
  // Realtime is unavailable or the publication was not enabled.
  phoneSyncInterval = setInterval(checkPhoneSync, 15000);

  console.log('Phone sync: realtime + 15s fallback initialized');
  checkPhoneSync();
}

function loadSettingsFromFile(): void {
  try {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const loaded = JSON.parse(data) as Partial<AppSettings>;
      Object.assign(settings, loaded);

      // Decrypt the at-rest secrets (supabaseKey, aiApiKey) if safeStorage is available.
      if (safeStorage.isEncryptionAvailable()) {
        if (settings.supabaseKey) {
          try {
            settings.supabaseKey = safeStorage.decryptString(
              Buffer.from(settings.supabaseKey, 'base64')
            );
          } catch (e) {
            console.warn(
              'Supabase key decryption failed, treating as plain text (backward compat):',
              e
            );
            // If decryption fails, key might already be plain text (backward compat)
          }
        }
        if (settings.aiApiKey) {
          try {
            settings.aiApiKey = safeStorage.decryptString(Buffer.from(settings.aiApiKey, 'base64'));
          } catch (e) {
            console.warn('AI key decryption failed, treating as plain text (backward compat):', e);
          }
        }
      }

      console.log('Ayarlar dosyadan yüklendi:', settingsPath);
    } else {
      console.log('Ayarlar dosyası bulunamadı, varsayılanlar kullanılacak.');
    }
  } catch (error) {
    console.error('Ayarlar yüklenirken hata oluştu:', error);
  }
}

function saveSettingsToFile(): void {
  try {
    if (!settingsPath) {
      settingsPath = path.join(app.getPath('userData'), 'settings.json');
    }

    const settingsToSave = { ...settings };
    if (safeStorage.isEncryptionAvailable()) {
      if (settings.supabaseKey) {
        settingsToSave.supabaseKey = safeStorage
          .encryptString(settings.supabaseKey)
          .toString('base64');
      }
      if (settings.aiApiKey) {
        settingsToSave.aiApiKey = safeStorage.encryptString(settings.aiApiKey).toString('base64');
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2), 'utf8');
    console.log('Ayarlar dosyaya kaydedildi:', settingsPath);
  } catch (error) {
    console.error('Ayarlar kaydedilirken hata oluştu:', error);
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#08111f',
    title: 'Gemini Ekran Yakalama',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'index.html'));
}

function getVirtualBounds(): Rect {
  return computeVirtualBounds(screen.getAllDisplays());
}

function createOverlayWindow(): void {
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
  overlayWindow.loadFile(path.join(app.getAppPath(), 'src', 'overlay.html'));
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
    if (!(app as any).isQuitting) {
      event.preventDefault();
      geminiWindow?.hide();
    }
  });

  geminiWindow.on('closed', () => {
    geminiWindow = null;
  });

  return geminiWindow;
}

async function openGeminiWindow(): Promise<BrowserWindow> {
  const windowInstance = createGeminiWindow();

  if (windowInstance.webContents.getURL() !== geminiUrl) {
    await windowInstance.loadURL(geminiUrl);
  }

  if (windowInstance.isMinimized()) {
    windowInstance.restore();
  }

  windowInstance.setAlwaysOnTop(true);
  windowInstance.show();
  windowInstance.focus();
  windowInstance.setAlwaysOnTop(false);
  return windowInstance;
}

async function ensureGeminiWindowLoaded(): Promise<BrowserWindow> {
  const windowInstance = createGeminiWindow();

  if (windowInstance.webContents.getURL() !== geminiUrl) {
    await windowInstance.loadURL(geminiUrl);
  }

  return windowInstance;
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', message);
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

function showSelectionOverlay(backgroundImagePath: string, bounds: Rect): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(false);
    if (bounds) {
      overlayWindow.setBounds(bounds);
    }
    sendOverlayState({
      visible: true,
      active: true,
      selection: selectionRect,
      backgroundImage: backgroundImagePath,
    });
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed() && selectionActive) {
        overlayWindow.showInactive();
      }
    }, 30);
  }
}

function hideSelectionOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    sendOverlayState({ visible: false, active: false, selection: null, backgroundImage: null });
    overlayWindow.hide();
  }
}

function setSelectionInstruction(message: string): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-message', message);
  }
}

function resetSelectionSession(): void {
  selectionActive = false;
  selectionHasAnnotations = false;
  selectionRect = null;
  selectionDisplay = null;
  capturedScreenImage = null;
  if (keyListenerProcess && !keyListenerProcess.killed) {
    keyListenerProcess.stdin?.write('INACTIVE\n');
  }
}

async function startSelectionSession(): Promise<void> {
  // Guard against re-entry: a second DOUBLE_CTRL can arrive before the async
  // screenshot resolves and sets selectionActive, which would start two sessions.
  if (selectionStarting || selectionActive) {
    return;
  }
  selectionStarting = true;
  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    selectionDisplay = activeDisplay;

    const imageBuffer = await screenshot({ format: 'png', screen: activeDisplay.id });
    capturedScreenImage = nativeImage.createFromBuffer(
      Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer)
    );

    const base64 = capturedScreenImage.toJPEG(85).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    selectionActive = true;
    if (keyListenerProcess && !keyListenerProcess.killed) {
      keyListenerProcess.stdin?.write('ACTIVE\n');
    }
    selectionRect = null;

    showSelectionOverlay(dataUrl, activeDisplay.bounds);
    setSelectionInstruction(
      'Alanı seç → X/Enter: Gemini · M: Telefon · C: Metin (OCR) · Esc: iptal'
    );
    setStatus('Seçim modu açık. Alanı fareyle çiz.');
  } catch (error: any) {
    console.error('Ekran yakalama hatası:', error);
    setStatus('Ekran yakalama başlatılamadı: ' + error.message);
  } finally {
    selectionStarting = false;
  }
}

function toAbsoluteRect(rect: Rect): Rect {
  return computeAbsoluteRect(rect, getVirtualBounds());
}

function cropImageToSelection(
  image: Electron.NativeImage,
  rect: Rect,
  display: Display
): Electron.NativeImage {
  const relative = computeCropRect(rect, display.bounds, image.getSize(), display.scaleFactor);
  return image.crop(relative);
}

// If the user drew annotations on the overlay, ask the renderer to composite the
// selection region + annotations into a PNG. Returns null when there are no
// annotations or compositing fails, so callers fall back to the plain crop.
async function getAnnotatedComposite(): Promise<Electron.NativeImage | null> {
  if (!selectionHasAnnotations || !overlayWindow || overlayWindow.isDestroyed()) {
    return null;
  }
  try {
    const dataUrl = await overlayWindow.webContents.executeJavaScript(
      'window.__ctrl2phoneCompose ? window.__ctrl2phoneCompose() : null'
    );
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

function getKeyListenerPath(): string {
  const possiblePaths = helperExeCandidates('key_listener.exe');
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `key_listener.exe not found at paths: ${possiblePaths.join(', ')}. Run: csc /target:winexe /out:key_listener.exe key_listener.cs`
  );
}

// Optional helper — returns null (rather than throwing) when not present, since
// the phone-sync panel is a nice-to-have.
function getPhotoDropperPath(): string | null {
  for (const p of helperExeCandidates('photo_dropper.exe')) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function startKeyListener(): void {
  stopKeyListener();

  const binaryPath = getKeyListenerPath();
  keyListenerProcess = spawn(binaryPath);

  keyListenerProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      handleGlobalKeyEvent(trimmed);
    }
  });

  keyListenerProcess.on('error', (err: Error) => {
    console.error('Key listener process error:', err);
    setStatus('Klavye dinleyici başlatılamadı');
  });

  // Push the current hotkey config to the freshly-spawned listener.
  sendKeyListenerConfig();

  setStatus('Çift Ctrl ile seçim modu hazır');
}

// Tell the C# listener which key to watch for and the double-press window.
function sendKeyListenerConfig(): void {
  if (keyListenerProcess && !keyListenerProcess.killed) {
    const vk = settings.hotkeyVk || 0xa2;
    const ms = settings.doublePressMs || 400;
    keyListenerProcess.stdin?.write(`CONFIG:${vk}:${ms}\n`);
  }
}

function stopKeyListener(): void {
  if (keyListenerProcess) {
    try {
      keyListenerProcess.kill();
    } catch {
      // ignore — process may already be gone
    }
    keyListenerProcess = null;
  }
}

function handleGlobalKeyEvent(event: string): void {
  if (event === 'DOUBLE_CTRL') {
    if (!selectionActive) {
      startSelectionSession();
    }
  } else if (event === 'KEY_X' || event === 'KEY_RETURN') {
    if (selectionActive) {
      if (!selectionRect) {
        setStatus('Önce fareyle bir alan seç.');
        return;
      }
      captureAndSend();
    }
  } else if (event === 'KEY_M') {
    if (selectionActive) {
      if (!selectionRect) {
        setStatus('Önce fareyle bir alan seç.');
        return;
      }
      captureAndSendToSupabase();
    }
  } else if (event === 'KEY_C') {
    if (selectionActive) {
      if (!selectionRect) {
        setStatus('Önce fareyle bir alan seç.');
        return;
      }
      captureAndExtractText();
    }
  } else if (event === 'KEY_ESCAPE') {
    if (selectionActive) {
      hideSelectionOverlay();
      resetSelectionSession();
      setStatus('Seçim iptal edildi');
    }
  } else if (event === 'KEY_Q') {
    // Q quits the app — only forwarded by the key listener while selection is
    // active, so it never fires while the user is typing in a window.
    if (selectionActive) {
      hideSelectionOverlay();
      resetSelectionSession();
    }
    app.quit();
  }
}

async function captureAndSend(): Promise<void> {
  try {
    if (!selectionRect || !selectionDisplay || !capturedScreenImage) {
      setStatus('Seçim alanı veya yakalanan ekran resmi bulunamadı');
      hideSelectionOverlay();
      resetSelectionSession();
      return;
    }

    const absoluteRect = toAbsoluteRect(selectionRect);
    const display = selectionDisplay;
    const clampedRect = clampRectToDisplay(absoluteRect, display.bounds);

    if (clampedRect.width <= 0 || clampedRect.height <= 0) {
      setStatus('Geçersiz seçim alanı');
      hideSelectionOverlay();
      resetSelectionSession();
      return;
    }

    const croppedImage =
      (await getAnnotatedComposite()) ??
      cropImageToSelection(capturedScreenImage, clampedRect, display);

    // Reset selection session immediately so the user gets control back
    hideSelectionOverlay();
    resetSelectionSession();

    clipboard.writeImage(croppedImage);

    // Route to a direct provider API when one is configured; otherwise fall back to
    // the legacy "paste into the Gemini web app" flow.
    if (isApiProviderConfigured()) {
      await analyzeWithApi(croppedImage);
      return;
    }

    const windowInstance = await openGeminiWindow();
    const composerFocused = await focusGeminiComposer(windowInstance, settings.prompt);

    sendPasteShortcut(windowInstance);

    setResponse(
      `Seçilen alan Gemini web'e kopyalandı. ${composerFocused ? 'Yapıştırma denendi.' : 'Yapıştırma kısayolu gönderildi.'}`
    );
    setStatus("Seçilen görsel Gemini web'e yapıştırıldı");
  } catch (error: any) {
    setResponse(`Hata: ${error.message}`);
    setStatus('Seçim veya yapıştırma sırasında hata');
    hideSelectionOverlay();
    resetSelectionSession();
  }
}

/** True when the user has picked an API provider and supplied the credentials it needs. */
function isApiProviderConfigured(): boolean {
  if (settings.aiProvider === 'web') {
    return false;
  }
  if (settings.aiProvider === 'custom') {
    // A local OpenAI-compatible server may need no key, but it always needs a base URL.
    return Boolean(settings.aiBaseUrl.trim());
  }
  return Boolean(settings.aiApiKey.trim());
}

/** Send the cropped PNG + prompt to the configured provider and show the reply in-app. */
async function analyzeWithApi(image: Electron.NativeImage): Promise<void> {
  setStatus('Yapay zekâ analiz ediyor…');
  setResponse('Analiz ediliyor… (yanıt birazdan burada görünecek)');
  try {
    const pngBase64 = image.toPNG().toString('base64');
    const text = await analyzeImage(
      {
        provider: settings.aiProvider as AiProvider,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
        baseUrl: settings.aiBaseUrl,
      },
      pngBase64,
      settings.prompt
    );
    setResponse(text);
    setStatus(`Yanıt alındı (${settings.aiProvider})`);
  } catch (error: any) {
    setResponse(`Yapay zekâ hatası: ${error.message}`);
    setStatus('Yapay zekâ isteği başarısız');
  }
}

async function captureAndSendToSupabase(): Promise<void> {
  try {
    if (!selectionRect || !selectionDisplay || !capturedScreenImage) {
      setStatus('Seçim alanı veya yakalanan ekran resmi bulunamadı');
      hideSelectionOverlay();
      resetSelectionSession();
      return;
    }

    if (!settings.supabaseUrl || !settings.supabaseKey) {
      setStatus('Supabase ayarları eksik! Lütfen ayarlardan doldurun.');
      setResponse('Hata: Supabase URL veya Anon Key tanımlanmamış. Ayarları kontrol edin.');
      hideSelectionOverlay();
      resetSelectionSession();
      return;
    }

    const absoluteRect = toAbsoluteRect(selectionRect);
    const display = selectionDisplay;
    const clampedRect = clampRectToDisplay(absoluteRect, display.bounds);

    if (clampedRect.width <= 0 || clampedRect.height <= 0) {
      setStatus('Geçersiz seçim alanı');
      hideSelectionOverlay();
      resetSelectionSession();
      return;
    }

    const croppedImage =
      (await getAnnotatedComposite()) ??
      cropImageToSelection(capturedScreenImage, clampedRect, display);
    const pngBuffer = croppedImage.toPNG();

    // Reset selection session immediately so the user gets control back
    hideSelectionOverlay();
    resetSelectionSession();
    setStatus("Görsel Supabase'e yükleniyor...");

    const bucket = settings.supabaseBucket || 'screenshots';
    // Unguessable name: a timestamp-based name would let anyone who knows the
    // bucket enumerate every screenshot by guessing recent timestamps.
    const fileName = `screenshot_${randomUUID()}.png`;

    if (!supabaseClient || supabaseClientUrl !== settings.supabaseUrl) {
      supabaseClient = createClient(settings.supabaseUrl, settings.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      supabaseClientUrl = settings.supabaseUrl;
    }

    const { error } = await supabaseClient.storage.from(bucket).upload(fileName, pngBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

    if (error) {
      throw new Error(`Supabase upload hatası: ${error.message}`);
    }

    // Signed URL (not getPublicUrl) so the link keeps working when the bucket is
    // private — and expires, so it isn't a permanent public handle to the image.
    let shareUrl = '';
    try {
      const { data: signed } = await supabaseClient.storage
        .from(bucket)
        .createSignedUrl(fileName, 60 * 60 * 24 * 7); // 7 gün geçerli
      shareUrl = signed?.signedUrl ?? '';
    } catch {
      // Signed URL üretilemezse (örn. izin yoksa) link göstermeden geç
    }

    setResponse(
      shareUrl
        ? `Supabase'e başarıyla yüklendi!\nGörsel Adresi (7 gün geçerli):\n${shareUrl}`
        : "Supabase'e başarıyla yüklendi! Telefon uygulamasından görüntüleyebilirsin."
    );
    setStatus('Seçilen görsel telefona gönderildi (Supabase)');
  } catch (error: any) {
    console.error('Supabase upload error:', error);
    setResponse(`Hata: ${error.message}`);
    setStatus('Supabase yükleme hatası');
    hideSelectionOverlay();
    resetSelectionSession();
  }
}

async function captureAndExtractText(): Promise<void> {
  try {
    if (!selectionRect || !selectionDisplay || !capturedScreenImage) {
      setStatus('Seçim alanı veya yakalanan ekran resmi bulunamadı');
      hideSelectionOverlay();
      resetSelectionSession();
      return;
    }

    const absoluteRect = toAbsoluteRect(selectionRect);
    const display = selectionDisplay;
    const clampedRect = clampRectToDisplay(absoluteRect, display.bounds);

    if (clampedRect.width <= 0 || clampedRect.height <= 0) {
      setStatus('Geçersiz seçim alanı');
      hideSelectionOverlay();
      resetSelectionSession();
      return;
    }

    const croppedImage =
      (await getAnnotatedComposite()) ??
      cropImageToSelection(capturedScreenImage, clampedRect, display);
    const pngBuffer = croppedImage.toPNG();

    // Give control back immediately; OCR can take a couple of seconds.
    hideSelectionOverlay();
    resetSelectionSession();
    setStatus('Metin tanınıyor (OCR)...');

    const {
      data: { text },
    } = await Tesseract.recognize(pngBuffer, 'eng+tur');
    const cleaned = text.trim();

    if (cleaned) {
      clipboard.writeText(cleaned);
      setResponse(`Tanınan metin panoya kopyalandı:\n\n${cleaned}`);
      setStatus('Metin panoya kopyalandı (OCR)');
    } else {
      setResponse('Seçili alanda metin bulunamadı.');
      setStatus('Metin bulunamadı');
    }
  } catch (error: any) {
    console.error('OCR error:', error);
    setResponse(
      `OCR hatası: ${error.message}\n(İlk kullanımda dil modeli indirilir; internet bağlantısı gerekir.)`
    );
    setStatus('OCR hatası');
    hideSelectionOverlay();
    resetSelectionSession();
  }
}

ipcMain.handle('app-ready', () => ({
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
  i18n: getStrings(resolveLang(settings.language, app.getLocale())),
  selectionActive,
}));

ipcMain.handle('generate-qr', async () => {
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
  try {
    const bucket = settings.supabaseBucket || 'screenshots';
    const sql = buildRlsSetupSql(bucket);
    clipboard.writeText(sql);
    // Deep-link to the user's last-used project SQL editor (the '_' placeholder).
    await shell.openExternal('https://supabase.com/dashboard/project/_/sql/new');
    return { ok: true, sql };
  } catch (error: any) {
    console.error('RLS kurulum hatası:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('save-settings', (_, nextSettings: Partial<AppSettings>) => {
  Object.assign(settings, {
    prompt: nextSettings.prompt ?? settings.prompt,
    supabaseUrl: nextSettings.supabaseUrl ?? settings.supabaseUrl,
    supabaseKey: nextSettings.supabaseKey ?? settings.supabaseKey,
    supabaseBucket: nextSettings.supabaseBucket ?? settings.supabaseBucket,
    autoCopyFromPhone: nextSettings.autoCopyFromPhone ?? settings.autoCopyFromPhone,
    hotkeyVk: nextSettings.hotkeyVk ?? settings.hotkeyVk,
    doublePressMs: nextSettings.doublePressMs ?? settings.doublePressMs,
    aiProvider: nextSettings.aiProvider ?? settings.aiProvider,
    aiApiKey: nextSettings.aiApiKey ?? settings.aiApiKey,
    aiModel: nextSettings.aiModel ?? settings.aiModel,
    aiBaseUrl: nextSettings.aiBaseUrl ?? settings.aiBaseUrl,
    language: nextSettings.language ?? settings.language,
  });

  supabaseClient = null;
  supabaseClientUrl = '';

  sendKeyListenerConfig();
  saveSettingsToFile();
  setupPhoneSyncPolling();
  return { ok: true };
});

ipcMain.handle('open-gemini', async () => {
  const windowInstance = await openGeminiWindow();
  return { ok: Boolean(windowInstance) };
});

ipcMain.handle('focus-gemini', async () => {
  const windowInstance = await openGeminiWindow();
  return { ok: Boolean(windowInstance) };
});

ipcMain.handle('capture-now', async () => {
  if (!selectionActive) {
    startSelectionSession();
    return { ok: true, mode: 'selection-opened' };
  }

  await captureAndSend();
  return { ok: true };
});

ipcMain.handle('set-selection', (_, payload: any) => {
  if (!selectionActive) {
    return { ok: false };
  }

  if (payload?.type === 'start') {
    selectionRect = null;
    selectionDisplay = null;
    return { ok: true };
  }

  if (payload?.type === 'update') {
    const rect = payload.rect as Rect;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      selectionRect = null;
      selectionDisplay = null;
      return { ok: true };
    }

    selectionRect = rect;
    selectionDisplay = screen.getDisplayMatching(toAbsoluteRect(rect));
    return { ok: true };
  }

  return { ok: false };
});

ipcMain.handle('cancel-selection', () => {
  hideSelectionOverlay();
  resetSelectionSession();
  setStatus('Seçim iptal edildi');
  return { ok: true };
});

ipcMain.handle('set-annotated', (_, hasAnnotations: boolean) => {
  selectionHasAnnotations = Boolean(hasAnnotations);
  return { ok: true };
});

ipcMain.handle('confirm-selection-gemini', async () => {
  if (selectionActive && selectionRect) {
    await captureAndSend();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('confirm-selection-phone', async () => {
  if (selectionActive && selectionRect) {
    await captureAndSendToSupabase();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('get-storage-usage', async () => {
  ensureSupabaseClient();
  if (!supabaseClient || !settings.supabaseBucket) {
    return { ok: false, error: 'Supabase client not initialized' };
  }
  try {
    const bucket = settings.supabaseBucket;

    // List all files in the root of the bucket
    const { data: files, error } = await supabaseClient.storage.from(bucket).list('', {
      limit: 1000,
    });
    if (error) throw error;

    let totalBytes = 0;
    if (files) {
      for (const f of files) {
        if (f.name !== 'to_pc' && f.metadata && f.metadata.size) {
          totalBytes += f.metadata.size;
        }
      }
    }

    // List to_pc files too
    let toPcFiles: any[] = [];
    try {
      const { data: toPc, error: toPcError } = await supabaseClient.storage
        .from(bucket)
        .list('to_pc', {
          limit: 1000,
        });
      if (!toPcError && toPc) toPcFiles = toPc;
    } catch {
      // to_pc klasörü yoksa yoksay
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
  ensureSupabaseClient();
  if (!supabaseClient || !settings.supabaseBucket) {
    return { ok: false, error: 'Supabase client not initialized' };
  }
  try {
    const bucket = settings.supabaseBucket;

    // 1. List files in root
    const { data: rootFiles, error: rootError } = await supabaseClient.storage
      .from(bucket)
      .list('', {
        limit: 1000,
      });
    if (rootError) throw rootError;

    const filesToDelete: string[] = [];
    if (rootFiles) {
      for (const f of rootFiles) {
        if (f.name !== 'to_pc' && f.name !== '.keep' && !f.name.startsWith('.')) {
          filesToDelete.push(f.name);
        }
      }
    }

    // 2. List files in to_pc
    let toPcFiles: any[] = [];
    try {
      const { data: toPc, error: toPcError } = await supabaseClient.storage
        .from(bucket)
        .list('to_pc', {
          limit: 1000,
        });
      if (!toPcError && toPc) toPcFiles = toPc;
    } catch {
      // to_pc klasörü yoksa yoksay
    }

    for (const f of toPcFiles) {
      if (f.name !== '.keep' && !f.name.startsWith('.')) {
        filesToDelete.push(`to_pc/${f.name}`);
      }
    }

    if (filesToDelete.length > 0) {
      const { error: removeError } = await supabaseClient.storage
        .from(bucket)
        .remove(filesToDelete);
      if (removeError) throw removeError;
    }

    return { ok: true, deletedCount: filesToDelete.length };
  } catch (err: any) {
    return { ok: false, error: err.message };
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

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    loadSettingsFromFile();
    createMainWindow();
    createOverlayWindow();
    // Don't let a missing/unbuilt key_listener.exe crash the whole startup chain.
    try {
      startKeyListener();
    } catch (err) {
      console.error('Klavye dinleyici başlatılamadı:', err);
      setStatus('Klavye dinleyici bulunamadı (key_listener.exe derlenmemiş olabilir).');
    }
    setupPhoneSyncPolling();

    setTimeout(() => {
      ensureGeminiWindowLoaded().catch((e) => console.error('Gemini ön-yükleme hatası:', e));
    }, 5000);

    autoUpdater
      .checkForUpdatesAndNotify()
      .catch((e) => console.error('Güncelleme kontrolü başarısız:', e));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        createOverlayWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  (app as any).isQuitting = true;
});

app.on('will-quit', () => {
  stopKeyListener();
  stopPhoneSyncPolling();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
