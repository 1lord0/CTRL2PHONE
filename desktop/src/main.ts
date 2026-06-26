import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  safeStorage,
  screen,
  Display,
} from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import screenshot from 'screenshot-desktop';
import QRCode from 'qrcode';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { autoUpdater } from 'electron-updater';
import { AppSettings, Rect } from './types';

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let geminiWindow: BrowserWindow | null = null;
let selectionActive = false;
let selectionRect: Rect | null = null;
let selectionDisplay: Display | null = null;
let capturedScreenImage: Electron.NativeImage | null = null;
let keyListenerProcess: ChildProcess | null = null;
let supabaseClient: SupabaseClient | null = null;
let supabaseClientUrl = '';

const settings: AppSettings = {
  prompt: 'Bu ekran görüntüsünü analiz et ve kısa bir özet ver.',
  supabaseUrl: '',
  supabaseKey: '',
  supabaseBucket: 'screenshots',
};

const geminiUrl = 'https://gemini.google.com/app';

let settingsPath: string | undefined;

function loadSettingsFromFile(): void {
  try {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const loaded = JSON.parse(data) as Partial<AppSettings>;
      Object.assign(settings, loaded);

      // Decrypt supabaseKey if it was encrypted with safeStorage
      if (settings.supabaseKey && safeStorage.isEncryptionAvailable()) {
        try {
          const encrypted = Buffer.from(settings.supabaseKey, 'base64');
          settings.supabaseKey = safeStorage.decryptString(encrypted);
        } catch (e) {
          console.warn(
            'Supabase key decryption failed, treating as plain text (backward compat):',
            e
          );
          // If decryption fails, key might already be plain text (backward compat)
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
    if (settings.supabaseKey && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(settings.supabaseKey);
      settingsToSave.supabaseKey = encrypted.toString('base64');
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2), 'utf8');
    console.log('Ayarlar dosyaya kaydedildi:', settingsPath);
  } catch (error) {
    console.error('Ayarlar kaydedilirken hata oluştu:', error);
  }
}

function handleKeyAction(key: string): boolean {
  const normalizedKey = String(key || '').toUpperCase();
  if (normalizedKey === 'Q') {
    app.quit();
    return true;
  }
  return false;
}

function attachKeyHandlers(windowInstance: BrowserWindow): void {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return;
  }

  windowInstance.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }

    const handled = handleKeyAction(input.key);
    if (handled) {
      event.preventDefault();
    }
  });
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
  attachKeyHandlers(mainWindow);
}

function getVirtualBounds(): Rect {
  const displays = screen.getAllDisplays();
  const bounds = displays.reduce(
    (acc, display) => ({
      x: Math.min(acc.x, display.bounds.x),
      y: Math.min(acc.y, display.bounds.y),
      right: Math.max(acc.right, display.bounds.x + display.bounds.width),
      bottom: Math.max(acc.bottom, display.bounds.y + display.bounds.height),
    }),
    {
      x: displays[0].bounds.x,
      y: displays[0].bounds.y,
      right: displays[0].bounds.x + displays[0].bounds.width,
      bottom: displays[0].bounds.y + displays[0].bounds.height,
    }
  );

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.right - bounds.x,
    height: bounds.bottom - bounds.y,
  };
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
  attachKeyHandlers(overlayWindow);
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

  attachKeyHandlers(geminiWindow);

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

async function focusGeminiComposer(windowInstance: BrowserWindow): Promise<boolean> {
  const focused = await windowInstance.webContents.executeJavaScript(`
    (() => {
      const selectors = ['textarea', 'input[type="text"]', '[contenteditable="true"]'];
      const element = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
      if (element) {
        element.focus();
        element.click();
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
  selectionRect = null;
  selectionDisplay = null;
  capturedScreenImage = null;
  if (keyListenerProcess && !keyListenerProcess.killed) {
    keyListenerProcess.stdin?.write('INACTIVE\n');
  }
}

async function startSelectionSession(): Promise<void> {
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
    setSelectionInstruction('Alanı fareyle seç, sonra X veya Enter ile gönder, Esc ile iptal et.');
    setStatus('Seçim modu açık. Alanı fareyle çiz.');
  } catch (error: any) {
    console.error('Ekran yakalama hatası:', error);
    setStatus('Ekran yakalama başlatılamadı: ' + error.message);
  }
}

function toAbsoluteRect(rect: Rect): Rect {
  const bounds = getVirtualBounds();

  return {
    x: rect.x + bounds.x,
    y: rect.y + bounds.y,
    width: rect.width,
    height: rect.height,
  };
}

function clampRectToDisplay(rect: Rect, displayBounds: Rect): Rect {
  const x = Math.max(rect.x, displayBounds.x);
  const y = Math.max(rect.y, displayBounds.y);
  const right = Math.min(rect.x + rect.width, displayBounds.x + displayBounds.width);
  const bottom = Math.min(rect.y + rect.height, displayBounds.y + displayBounds.height);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function cropImageToSelection(
  image: Electron.NativeImage,
  rect: Rect,
  display: Display
): Electron.NativeImage {
  const scaleFactor = display.scaleFactor || 1;
  const relative = {
    x: Math.round((rect.x - display.bounds.x) * scaleFactor),
    y: Math.round((rect.y - display.bounds.y) * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor),
  };

  return image.crop(relative);
}

function getKeyListenerPath(): string {
  const possiblePaths = [
    path.join(__dirname, 'key_listener.exe'),
    path.join(__dirname, '..', 'src', 'key_listener.exe'),
    path.join(app.getAppPath(), 'src', 'key_listener.exe'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'key_listener.exe not found. Run: csc /target:winexe /out:key_listener.exe key_listener.cs'
  );
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

  setStatus('Çift Ctrl ile seçim modu hazır');
}

function stopKeyListener(): void {
  if (keyListenerProcess) {
    try {
      keyListenerProcess.kill();
    } catch (e) {
      // ignore
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
  } else if (event === 'KEY_ESCAPE') {
    if (selectionActive) {
      hideSelectionOverlay();
      resetSelectionSession();
      setStatus('Seçim iptal edildi');
    }
  }
}

async function captureAndSend(): Promise<void> {
  try {
    if (!selectionRect || !selectionDisplay || !capturedScreenImage) {
      setStatus('Seçim alanı veya yakalanan ekran resmi bulunamadı');
      return;
    }

    const absoluteRect = toAbsoluteRect(selectionRect);
    const display = selectionDisplay;
    const clampedRect = clampRectToDisplay(absoluteRect, display.bounds);

    if (clampedRect.width <= 0 || clampedRect.height <= 0) {
      setStatus('Geçersiz seçim alanı');
      return;
    }

    hideSelectionOverlay();

    const croppedImage = cropImageToSelection(capturedScreenImage, clampedRect, display);

    clipboard.writeImage(croppedImage);

    const windowInstance = await openGeminiWindow();
    const composerFocused = await focusGeminiComposer(windowInstance);

    sendPasteShortcut(windowInstance);

    setResponse(
      `Seçilen alan Gemini web'e kopyalandı. ${composerFocused ? 'Yapıştırma denendi.' : 'Yapıştırma kısayolu gönderildi.'}`
    );
    setStatus("Seçilen görsel Gemini web'e yapıştırıldı");
    resetSelectionSession();
  } catch (error: any) {
    setResponse(`Hata: ${error.message}`);
    setStatus('Seçim veya yapıştırma sırasında hata');
  }
}

async function captureAndSendToSupabase(): Promise<void> {
  try {
    if (!selectionRect || !selectionDisplay || !capturedScreenImage) {
      setStatus('Seçim alanı veya yakalanan ekran resmi bulunamadı');
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
      return;
    }

    hideSelectionOverlay();
    setStatus("Görsel Supabase'e yükleniyor...");

    const croppedImage = cropImageToSelection(capturedScreenImage, clampedRect, display);
    const pngBuffer = croppedImage.toPNG();

    const bucket = settings.supabaseBucket || 'screenshots';
    const fileName = `screenshot_${Date.now()}.png`;

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

    const { data: publicUrlData } = supabaseClient.storage.from(bucket).getPublicUrl(fileName);

    setResponse(`Supabase'e başarıyla yüklendi!\nGörsel Adresi:\n${publicUrlData.publicUrl}`);
    setStatus('Seçilen görsel telefona gönderildi (Supabase)');
    resetSelectionSession();
  } catch (error: any) {
    console.error('Supabase upload error:', error);
    setResponse(`Hata: ${error.message}`);
    setStatus('Supabase yükleme hatası');
    resetSelectionSession();
  }
}

ipcMain.handle('app-ready', () => ({
  prompt: settings.prompt,
  supabaseUrl: settings.supabaseUrl,
  supabaseKey: settings.supabaseKey,
  supabaseBucket: settings.supabaseBucket,
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
      bucket: settings.supabaseBucket || 'SCREENSHOTS',
    });
    const dataUrl = await QRCode.toDataURL(data);
    return { ok: true, dataUrl };
  } catch (error: any) {
    console.error('QR Kod oluşturma hatası:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('save-settings', (_, nextSettings: Partial<AppSettings>) => {
  Object.assign(settings, {
    prompt: nextSettings.prompt ?? settings.prompt,
    supabaseUrl: nextSettings.supabaseUrl ?? settings.supabaseUrl,
    supabaseKey: nextSettings.supabaseKey ?? settings.supabaseKey,
    supabaseBucket: nextSettings.supabaseBucket ?? settings.supabaseBucket,
  });

  supabaseClient = null;
  supabaseClientUrl = '';

  saveSettingsToFile();
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

app.whenReady().then(() => {
  loadSettingsFromFile();
  createMainWindow();
  createOverlayWindow();
  startKeyListener();

  setTimeout(() => {
    ensureGeminiWindowLoaded();
  }, 5000);

  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createOverlayWindow();
    }
  });
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
});

app.on('will-quit', () => {
  stopKeyListener();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
