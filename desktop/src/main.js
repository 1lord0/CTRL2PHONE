const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const screenshot = require('screenshot-desktop');
const QRCode = require('qrcode');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

let mainWindow;
let overlayWindow;
let geminiWindow;
let selectionActive = false;
let selectionRect = null;
let selectionDisplay = null;
let capturedScreenImage = null;
let keyListenerProcess = null;
let settings = {
  prompt: 'Bu ekran görüntüsünü analiz et ve kısa bir özet ver.',
  supabaseUrl: '',
  supabaseKey: '',
  supabaseBucket: 'screenshots',
};
const geminiUrl = 'https://gemini.google.com/app';

let settingsPath;

function loadSettingsFromFile() {
  try {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const loaded = JSON.parse(data);
      settings = { ...settings, ...loaded };
      console.log('Ayarlar dosyadan yüklendi:', settingsPath);
    } else {
      console.log('Ayarlar dosyası bulunamadı, varsayılanlar kullanılacak.');
    }
  } catch (error) {
    console.error('Ayarlar yüklenirken hata oluştu:', error);
  }
}

function saveSettingsToFile() {
  try {
    if (!settingsPath) {
      settingsPath = path.join(app.getPath('userData'), 'settings.json');
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log('Ayarlar dosyaya kaydedildi:', settingsPath);
  } catch (error) {
    console.error('Ayarlar kaydedilirken hata oluştu:', error);
  }
}


function handleKeyAction(key) {
  const normalizedKey = String(key || '').toUpperCase();
  if (normalizedKey === 'Q') {
    app.quit();
    return true;
  }
  return false;
}

function attachKeyHandlers(windowInstance) {
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

function createMainWindow() {
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
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'index.html'));
  attachKeyHandlers(mainWindow);
}

function getVirtualBounds() {
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

function createOverlayWindow() {
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
      webSecurity: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(app.getAppPath(), 'src', 'overlay.html'));
  attachKeyHandlers(overlayWindow);
}

function createGeminiWindow() {
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
    if (!app.isQuitting) {
      event.preventDefault();
      geminiWindow.hide();
    }
  });

  geminiWindow.on('closed', () => {
    geminiWindow = null;
  });

  attachKeyHandlers(geminiWindow);

  return geminiWindow;
}

async function openGeminiWindow() {
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

async function ensureGeminiWindowLoaded() {
  const windowInstance = createGeminiWindow();

  if (windowInstance.webContents.getURL() !== geminiUrl) {
    await windowInstance.loadURL(geminiUrl);
  }

  return windowInstance;
}

async function focusGeminiComposer(windowInstance) {
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

function sendPasteShortcut(windowInstance) {
  windowInstance.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['ctrl'] });
  windowInstance.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['ctrl'] });
}

function sendEnterShortcut(windowInstance) {
  windowInstance.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  windowInstance.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
}

function setStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', message);
  }
}

function setResponse(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('response', message);
  }
}

function sendOverlayState(state) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-state', state);
  }
}

function showSelectionOverlay(backgroundImagePath, bounds) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(false);
    if (bounds) {
      overlayWindow.setBounds(bounds);
    }
    sendOverlayState({
      visible: true,
      active: true,
      selection: selectionRect,
      backgroundImage: backgroundImagePath
    });
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed() && selectionActive) {
        overlayWindow.showInactive();
      }
    }, 30);
  }
}

function hideSelectionOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    sendOverlayState({ visible: false, active: false, selection: null, backgroundImage: null });
    overlayWindow.hide();
  }
}

function setSelectionInstruction(message) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay-message', message);
  }
}

function resetSelectionSession() {
  selectionActive = false;
  selectionRect = null;
  selectionDisplay = null;
  capturedScreenImage = null;
  if (keyListenerProcess && !keyListenerProcess.killed) {
    keyListenerProcess.stdin.write("INACTIVE\n");
  }
}

async function startSelectionSession() {
  try {
    // 1. Find target display
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    selectionDisplay = activeDisplay;

    // 2. Capture screenshot of this display using screenshot-desktop (extremely robust)
    const imageBuffer = await screenshot({ format: 'png', screen: activeDisplay.id });
    capturedScreenImage = nativeImage.createFromBuffer(Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer));

    // Convert directly to high-quality JPEG base64 data URL for instant memory transfer (no disk write!)
    const base64 = capturedScreenImage.toJPEG(85).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    // 3. Show overlay with this background image
    selectionActive = true;
    if (keyListenerProcess && !keyListenerProcess.killed) {
      keyListenerProcess.stdin.write("ACTIVE\n");
    }
    selectionRect = null;
    
    showSelectionOverlay(dataUrl, activeDisplay.bounds);
    setSelectionInstruction('Alanı fareyle seç, sonra X veya Enter ile gönder, Esc ile iptal et.');
    setStatus('Seçim modu açık. Alanı fareyle çiz.');
  } catch (error) {
    console.error('Ekran yakalama hatası:', error);
    setStatus('Ekran yakalama başlatılamadı: ' + error.message);
  }
}

function normalizeRect(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return { x, y, width, height };
}

function toAbsoluteRect(rect) {
  const bounds = getVirtualBounds();

  return {
    x: rect.x + bounds.x,
    y: rect.y + bounds.y,
    width: rect.width,
    height: rect.height,
  };
}

function clampRectToDisplay(rect, displayBounds) {
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

function cropImageToSelection(image, rect, display) {
  const scaleFactor = display.scaleFactor || 1;
  const relative = {
    x: Math.round((rect.x - display.bounds.x) * scaleFactor),
    y: Math.round((rect.y - display.bounds.y) * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor),
  };

  return image.crop(relative);
}

function startKeyListener() {
  stopKeyListener();

  const binaryPath = path.join(__dirname, 'key_listener.exe');
  keyListenerProcess = spawn(binaryPath);

  keyListenerProcess.stdout.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      handleGlobalKeyEvent(trimmed);
    }
  });

  keyListenerProcess.on('error', (err) => {
    console.error('Key listener process error:', err);
    setStatus('Klavye dinleyici başlatılamadı');
  });

  setStatus('Çift Ctrl ile seçim modu hazır');
}

function stopKeyListener() {
  if (keyListenerProcess) {
    try {
      keyListenerProcess.kill();
    } catch (e) {}
    keyListenerProcess = null;
  }
}

function handleGlobalKeyEvent(event) {
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

async function captureAndSend() {
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

    setResponse(`Seçilen alan Gemini web'e kopyalandı. ${composerFocused ? 'Yapıştırma denendi.' : 'Yapıştırma kısayolu gönderildi.'}`);
    setStatus("Seçilen görsel Gemini web'e yapıştırıldı");
    resetSelectionSession();
  } catch (error) {
    setResponse(`Hata: ${error.message}`);
    setStatus('Seçim veya yapıştırma sırasında hata');
  }
}

async function captureAndSendToSupabase() {
  try {
    if (!selectionRect || !selectionDisplay || !capturedScreenImage) {
      setStatus('Seçim alanı veya yakalanan ekran resmi bulunamadı');
      return;
    }

    if (!settings.supabaseUrl || !settings.supabaseKey) {
      setStatus('Supabase ayarları eksik! Lütfen ayarlardan doldurun.');
      setResponse('Hata: Supabase URL veya Key tanımlanmamış. Ayarları kontrol edin.');
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
    setStatus('Görsel Supabase\'e yükleniyor...');

    const croppedImage = cropImageToSelection(capturedScreenImage, clampedRect, display);
    const pngBuffer = croppedImage.toPNG();

    const cleanUrl = settings.supabaseUrl.replace(/\/$/, '');
    const bucket = settings.supabaseBucket || 'screenshots';
    const fileName = `screenshot_${Date.now()}.png`;
    const uploadUrl = `${cleanUrl}/storage/v1/object/${bucket}/${fileName}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'apikey': settings.supabaseKey,
        'Authorization': `Bearer ${settings.supabaseKey}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
        'cache-control': '0'
      },
      body: pngBuffer
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Supabase API yanıtı başarısız (${response.status}): ${errText}`);
    }

    setResponse(`Supabase'e başarıyla yüklendi!\nGörsel Adresi:\n${cleanUrl}/storage/v1/object/public/${bucket}/${fileName}`);
    setStatus("Seçilen görsel telefona gönderildi (Supabase)");
    resetSelectionSession();
  } catch (error) {
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
  } catch (error) {
    console.error('QR Kod oluşturma hatası:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('save-settings', (_, nextSettings) => {
  settings = {
    ...settings,
    prompt: nextSettings.prompt ?? settings.prompt,
    supabaseUrl: nextSettings.supabaseUrl ?? settings.supabaseUrl,
    supabaseKey: nextSettings.supabaseKey ?? settings.supabaseKey,
    supabaseBucket: nextSettings.supabaseBucket ?? settings.supabaseBucket,
  };

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

ipcMain.handle('set-selection', (_, payload) => {
  if (!selectionActive) {
    return { ok: false };
  }

  if (payload?.type === 'start') {
    selectionRect = null;
    selectionDisplay = null;
    return { ok: true };
  }

  if (payload?.type === 'update') {
    const rect = payload.rect;
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

app.whenReady().then(() => {
  loadSettingsFromFile();
  createMainWindow();
  createOverlayWindow();
  startKeyListener();

  // Gemini web'i 5 saniye sonra arka planda yükle (ana pencere focus'unu çalmasın)
  setTimeout(() => {
    ensureGeminiWindowLoaded();
  }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createOverlayWindow();
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  stopKeyListener();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});