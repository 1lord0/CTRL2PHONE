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

// GPU acceleration is enabled (required for native startDrag to work on Windows)

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
  autoCopyFromPhone: true,
};

const geminiUrl = 'https://gemini.google.com/app';

let settingsPath: string | undefined;
let phoneSyncInterval: NodeJS.Timeout | null = null;

function stopPhoneSyncPolling(): void {
  if (phoneSyncInterval) {
    clearInterval(phoneSyncInterval);
    phoneSyncInterval = null;
  }
}

async function checkPhoneSync(): Promise<void> {
  if (!settings.autoCopyFromPhone) {
    return;
  }

  if (!settings.supabaseUrl || !settings.supabaseKey) {
    return;
  }

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
      } else {
        console.error('Phone sync: downloaded file is not a valid image');
      }

      // Delete from storage (cleanup)
      const { error: deleteError } = await supabaseClient.storage.from(bucket).remove([filePath]);

      if (deleteError) {
        console.error(`Phone sync: failed to delete ${filePath}:`, deleteError);
      }
    }

    if (downloadedLocalPaths.length > 0) {
      const possibleDropperPaths = [
        path.join(process.resourcesPath, 'src', 'photo_dropper.exe'),
        path.join(process.resourcesPath, 'photo_dropper.exe'),
        path.join(__dirname, 'photo_dropper.exe'),
        path.join(__dirname, '..', 'src', 'photo_dropper.exe'),
        path.join(app.getAppPath(), 'src', 'photo_dropper.exe'),
      ];
      let dropperPath = '';
      for (const p of possibleDropperPaths) {
        if (fs.existsSync(p)) {
          dropperPath = p;
          break;
        }
      }

      if (dropperPath) {
        spawn(dropperPath, downloadedLocalPaths, {
          detached: true,
          stdio: 'ignore'
        }).unref();
      } else {
        console.error('[Phone Sync] photo_dropper.exe not found at paths:', possibleDropperPaths.join(', '));
      }

      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const count = downloadedLocalPaths.length;
        const notification = new Notification({
          title: count > 1 ? 'Telefondan Görseller Alındı' : 'Telefondan Görsel Alındı',
          body: count > 1 ? `${count} adet fotoğraf paneli açıldı! Sürükle-bırak kullanabilirsiniz.` : 'Fotoğraf paneli açıldı! Sürükle-bırak kullanabilirsiniz.',
          silent: false,
        });
        notification.show();
      }

      setStatus(downloadedLocalPaths.length > 1 ? `${downloadedLocalPaths.length} görsel telefondan alındı` : 'Görsel telefondan alındı');
      setResponse(`${downloadedLocalPaths.length} adet görsel telefondan alındı ve sürükle-bırak paneli açıldı.`);
    }
  } catch (err: any) {
    console.error('Error in checkPhoneSync:', err);
  }
}

function setupPhoneSyncPolling(): void {
  stopPhoneSyncPolling();

  if (!settings.autoCopyFromPhone) {
    console.log('Phone sync: disabled by settings');
    return;
  }

  if (!settings.supabaseUrl || !settings.supabaseKey) {
    console.log('Phone sync: waiting for Supabase settings');
    return;
  }

  console.log('Phone sync: polling initialized');
  phoneSyncInterval = setInterval(checkPhoneSync, 4000);
}

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

async function focusGeminiComposer(windowInstance: BrowserWindow, promptText: string): Promise<boolean> {
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
    path.join(process.resourcesPath, 'src', 'key_listener.exe'),
    path.join(process.resourcesPath, 'key_listener.exe'),
    path.join(__dirname, 'key_listener.exe'),
    path.join(__dirname, '..', 'src', 'key_listener.exe'),
    path.join(app.getAppPath(), 'src', 'key_listener.exe'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `key_listener.exe not found at paths: ${possiblePaths.join(', ')}. Run: csc /target:winexe /out:key_listener.exe key_listener.cs`
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

    const croppedImage = cropImageToSelection(capturedScreenImage, clampedRect, display);

    // Reset selection session immediately so the user gets control back
    hideSelectionOverlay();
    resetSelectionSession();

    clipboard.writeImage(croppedImage);

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

    const croppedImage = cropImageToSelection(capturedScreenImage, clampedRect, display);
    const pngBuffer = croppedImage.toPNG();

    // Reset selection session immediately so the user gets control back
    hideSelectionOverlay();
    resetSelectionSession();
    setStatus("Görsel Supabase'e yükleniyor...");

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
  } catch (error: any) {
    console.error('Supabase upload error:', error);
    setResponse(`Hata: ${error.message}`);
    setStatus('Supabase yükleme hatası');
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
    autoCopyFromPhone: nextSettings.autoCopyFromPhone ?? settings.autoCopyFromPhone,
  });

  supabaseClient = null;
  supabaseClientUrl = '';

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
      const { data: toPc, error: toPcError } = await supabaseClient.storage.from(bucket).list('to_pc', {
        limit: 1000,
      });
      if (!toPcError && toPc) toPcFiles = toPc;
    } catch (_) {}

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
      usedPercentage: (totalBytes / limitBytes) * 100
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('purge-storage', async () => {
  if (!supabaseClient || !settings.supabaseBucket) {
    return { ok: false, error: 'Supabase client not initialized' };
  }
  try {
    const bucket = settings.supabaseBucket;
    
    // 1. List files in root
    const { data: rootFiles, error: rootError } = await supabaseClient.storage.from(bucket).list('', {
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
      const { data: toPc, error: toPcError } = await supabaseClient.storage.from(bucket).list('to_pc', {
        limit: 1000,
      });
      if (!toPcError && toPc) toPcFiles = toPc;
    } catch (_) {}

    for (const f of toPcFiles) {
      if (f.name !== '.keep' && !f.name.startsWith('.')) {
        filesToDelete.push(`to_pc/${f.name}`);
      }
    }

    if (filesToDelete.length > 0) {
      const { error: removeError } = await supabaseClient.storage.from(bucket).remove(filesToDelete);
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
    startKeyListener();
    setupPhoneSyncPolling();

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
