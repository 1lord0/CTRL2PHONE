"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const crypto_1 = require("crypto");
const screenshot_desktop_1 = __importDefault(require("screenshot-desktop"));
const screenCaptureSource_1 = require("./lib/screenCaptureSource");
const qrcode_1 = __importDefault(require("qrcode"));
const supabase_js_1 = require("@supabase/supabase-js");
const electron_updater_1 = require("electron-updater");
const geometry_1 = require("./lib/geometry");
const supabaseSetup_1 = require("./lib/supabaseSetup");
const aiProviders_1 = require("./lib/aiProviders");
const ocr_1 = require("./lib/ocr");
const clipboardWrite_1 = require("./lib/clipboardWrite");
const i18n_1 = require("./lib/i18n");
const childProcess_1 = require("./lib/childProcess");
const pillVisibility_1 = require("./lib/pillVisibility");
const overlayActivation_1 = require("./lib/overlayActivation");
const copySelection_1 = require("./lib/copySelection");
const selectionElectronDrag_1 = require("./lib/selectionElectronDrag");
const downloadedFileAccess_1 = require("./lib/downloadedFileAccess");
const settingsStore_1 = require("./main/settingsStore");
const supabaseRuntime_1 = require("./main/supabaseRuntime");
const phoneSyncState_1 = require("./main/phoneSyncState");
const notificationController_1 = require("./main/notificationController");
const clipboardSyncController_1 = require("./main/clipboardSyncController");
const geminiWindowController_1 = require("./main/geminiWindowController");
const phoneFileSyncController_1 = require("./main/phoneFileSyncController");
// GPU acceleration is enabled (required for native startDrag to work on Windows)
let mainWindow = null;
let overlayWindow = null;
let selectionActive = false;
let selectionStarting = false;
let selectionHasAnnotations = false;
let selectionRect = null;
let selectionDisplay = null;
let capturedScreenImage = null;
let selectionSessionId = 0;
let selectionActionInFlightSessionId = null;
let selectionDragGeneration = 0;
let selectionDragEnabled = false;
let selectionSessionStartTime = 0;
let currentSelectionDragFilePath = null;
let downloadedPhoneFiles = [];
let keyListenerProcess = null;
let pillHudProcess = null;
let useNativePillHud = false;
let nativeHudDisabledForRun = false;
let pillHudReadyTimer = null;
const intentionallyStoppedPillHuds = new WeakSet();
let shutdownStarted = false;
let storagePurgeInFlightGeneration = null;
let overlayLifecycle = null;
let overlayGeneration = 0;
let pendingRenderWaiter = null;
function clearPendingRenderWaiter() {
    if (pendingRenderWaiter) {
        pendingRenderWaiter.reject(new Error('Render waiter cleared/cancelled'));
        pendingRenderWaiter = null;
    }
}
function sendSelectionDragState(sessionId, ready, reason) {
    if (overlayWindow && !overlayWindow.isDestroyed() && isSelectionSessionCurrent(sessionId)) {
        overlayWindow.webContents.send('selection-drag-state', { sessionId, ready, reason });
    }
}
let transientPillActive = false;
let transientPillTimer = null;
let mainWindowPageLoad = null;
let mainWindowPageLoadGeneration = 0;
let _pillHudFallbackInFlight = null;
const settings = (0, settingsStore_1.createDefaultSettings)();
const settingsStore = (0, settingsStore_1.createElectronSettingsStore)(settings);
const supabaseRuntime = (0, supabaseRuntime_1.createSupabaseRuntime)(settings, {
    createClient: (url, key) => (0, supabase_js_1.createClient)(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    }),
    onInvalidate: () => {
        stopPhoneSyncPolling();
        stopClipboardPolling();
    },
});
const phoneSyncState = (0, phoneSyncState_1.createElectronPhoneSyncState)();
const phoneFileSyncController = (0, phoneFileSyncController_1.createPhoneFileSyncController)({
    isEnabled: () => settings.autoCopyFromPhone,
    getContext: () => getSupabaseContext(),
    isContextCurrent: context => isSupabaseContextCurrent(context),
    isSynced: (context, filePath, file) => phoneSyncState.isSynced(context, filePath, file),
    markSynced: (context, filePath, file) => phoneSyncState.markSynced(context, filePath, file),
    listRemoteFiles: async (context) => {
        const { data, error } = await context.client.storage.from(context.bucket).list('to_pc', {
            limit: 100,
            sortBy: { column: 'created_at', order: 'desc' },
        });
        return {
            files: (data ?? []).map(file => ({
                name: file.name,
                id: file.id,
                updated_at: file.updated_at,
            })),
            error: error?.message ?? null,
        };
    },
    downloadFile: async (context, file, batchIndex) => {
        const remotePath = `to_pc/${file.name}`;
        const { data: fileBlob, error } = await context.client.storage
            .from(context.bucket)
            .download(remotePath);
        if (error) {
            console.error(`Phone sync: failed to download ${remotePath}:`, error);
            return null;
        }
        const arrayBuffer = await fileBlob.arrayBuffer();
        if (!isSupabaseContextCurrent(context))
            return null;
        const buffer = Buffer.from(arrayBuffer);
        const image = electron_1.nativeImage.createFromBuffer(buffer);
        if (image.isEmpty()) {
            console.error('Phone sync: downloaded file is not a valid image (kept for retry)');
            return null;
        }
        if (!(0, clipboardWrite_1.isLocalClipboardGuarded)())
            electron_1.clipboard.writeImage(image);
        const extension = file.name.split('.').at(-1) || 'png';
        const tempDir = path.join(electron_1.app.getPath('temp'), 'ctrl2phone');
        if (!fs.existsSync(tempDir))
            fs.mkdirSync(tempDir, { recursive: true });
        const localPath = path.join(tempDir, `phone_${Date.now()}_${batchIndex}.${extension}`);
        fs.writeFileSync(localPath, buffer);
        return localPath;
    },
    deleteRemoteFile: async (context, filePath) => {
        if (!isSupabaseContextCurrent(context))
            return null;
        const { error } = await context.client.storage.from(context.bucket).remove([filePath]);
        return error?.message ?? null;
    },
    notifyDownloads: paths => notifyPhoneDownloads([...paths]),
    subscribe: (context, onFile, onSubscribed) => {
        const channel = context.client
            .channel(`ctrl2phone-to-pc-${context.generation}`)
            .on('postgres_changes', {
            event: 'INSERT',
            schema: 'storage',
            table: 'objects',
            filter: `bucket_id=eq.${context.bucket}`,
        }, (payload) => {
            const row = payload.new;
            if (!row?.name)
                return;
            onFile({ name: row.name, id: row.id, updated_at: row.updated_at });
        })
            .subscribe(status => {
            if (status === 'SUBSCRIBED')
                onSubscribed();
        });
        return { client: context.client, channel };
    },
    removeSubscription: async (subscription) => {
        await subscription.client.removeChannel(subscription.channel);
    },
    log: message => console.log(message),
    warn: (message, detail) => console.warn(message, detail ?? ''),
    error: (message, error) => console.error(message, error),
});
const notificationController = (0, notificationController_1.createElectronNotificationController)(() => shutdownStarted);
const geminiWindowController = (0, geminiWindowController_1.createElectronGeminiWindowController)(() => shutdownStarted);
const clipboardSyncController = (0, clipboardSyncController_1.createClipboardSyncController)({
    readClipboard: () => electron_1.clipboard.readText(),
    writeClipboard: value => electron_1.clipboard.writeText(value),
    isClipboardGuarded: () => (0, clipboardWrite_1.isLocalClipboardGuarded)(),
    getContext: () => getSupabaseContext(),
    isContextCurrent: context => isSupabaseContextCurrent(context),
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
            row: (0, clipboardSyncController_1.parseMobileClipboardRow)(data?.[0]),
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
    log: message => console.log(message),
    warn: (message, detail) => console.warn(message, detail ?? ''),
    error: (message, error) => console.error(message, error),
});
const PILL_MIN = { width: 220, height: 44 };
const PILL_MAX = { width: 720, height: 80 };
const PILL_DEFAULT = { width: 320, height: 52 };
const PILL_BG_COLOR = '#121826';
const PANEL_BG_COLOR = '#0a1222';
const WIN32_OPAQUE_PILL = process.platform === 'win32';
const COMPACT_PILL_LEVEL = 'screen-saver';
const COMPACT_PILL_RELATIVE = 1;
function pillMaxWidthForDisplay(display = electron_1.screen.getPrimaryDisplay()) {
    return Math.min(PILL_MAX.width, Math.round(display.workArea.width * 0.62));
}
const PANEL_PRESENTED = { width: 420, height: 640 };
let compactPillSize = { ...PILL_DEFAULT };
const PILL_HUD_LEVEL = 'screen-saver';
const PILL_HUD_RELATIVE = 1;
let panelMode = 'compact';
let savedPillBounds = null;
let pillHudElevated = false;
let mainWindowPage = 'pill';
let ocrInFlight = false;
function isWindowUsable(window) {
    return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}
function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
function stopPhoneSyncPolling() {
    phoneFileSyncController.stop();
}
function stopClipboardPolling() {
    clipboardSyncController.stopPolling();
}
function beginShutdown() {
    if (shutdownStarted)
        return false;
    shutdownStarted = true;
    electron_1.app.isQuitting = true;
    overlayGeneration += 1;
    selectionSessionId += 1;
    selectionActive = false;
    selectionDragEnabled = false;
    selectionStarting = false;
    selectionActionInFlightSessionId = null;
    invalidateSelectionDragAsset();
    clearTransientPillTimer();
    transientPillActive = false;
    notificationController.shutdown();
    overlayLifecycle?.resolveRendererReady();
    stopNativePillHud();
    stopKeyListener();
    stopPhoneSyncPolling();
    stopClipboardPolling();
    return true;
}
function quitApplication() {
    beginShutdown();
    electron_1.app.quit();
}
async function sendClipboardToPhone() {
    return await clipboardSyncController.sendToPhone();
}
function setupClipboardPolling() {
    clipboardSyncController.setupPolling();
}
function getSupabaseContext() {
    return supabaseRuntime.getContext();
}
function isSupabaseContextCurrent(context) {
    return supabaseRuntime.isCurrent(context);
}
function broadcastPhoneDownloads() {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
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
function notifyPhoneDownloads(downloadedLocalPaths) {
    if (downloadedLocalPaths.length === 0)
        return;
    downloadedPhoneFiles.push(...downloadedLocalPaths);
    broadcastPhoneDownloads();
    const count = downloadedLocalPaths.length;
    const title = count > 1 ? 'Telefondan Dosyalar Alındı' : 'Telefondan Dosya Alındı';
    const body = count > 1
        ? `${count} adet dosya yüzen çubuğa eklendi!`
        : 'Yeni dosya yüzen çubuğa eklendi!';
    showCustomNotification(title, body, 'sync');
    setStatus(downloadedLocalPaths.length > 1
        ? `${downloadedLocalPaths.length} dosya telefondan alındı`
        : 'Dosya telefondan alındı');
    setResponse(`${downloadedLocalPaths.length} adet dosya telefondan alındı. Yüzen çubuktan sürükleyerek alabilirsiniz.`);
}
function setupPhoneSyncPolling() {
    phoneFileSyncController.setup();
}
function panelWindowSize() {
    const work = electron_1.screen.getPrimaryDisplay().workArea;
    return {
        width: PANEL_PRESENTED.width,
        height: Math.min(PANEL_PRESENTED.height, work.height - 48),
    };
}
function clampCompactSize(width, height, display) {
    const maxW = pillMaxWidthForDisplay(display);
    return {
        width: Math.min(maxW, Math.max(PILL_MIN.width, Math.round(width))),
        height: Math.min(PILL_MAX.height, Math.max(PILL_MIN.height, Math.round(height))),
    };
}
function defaultPillPosition() {
    const work = electron_1.screen.getPrimaryDisplay().workArea;
    return {
        x: work.x + Math.round((work.width - compactPillSize.width) / 2),
        y: work.y + 10,
    };
}
function getInitialPanelBounds() {
    const pill = defaultPillPosition();
    return {
        x: pill.x,
        y: pill.y,
        width: compactPillSize.width,
        height: compactPillSize.height,
    };
}
function clampPresentedBounds(bounds) {
    const size = panelWindowSize();
    const display = electron_1.screen.getDisplayMatching(bounds);
    const work = display.workArea;
    const x = Math.min(Math.max(work.x, bounds.x), work.x + work.width - size.width);
    const y = Math.min(Math.max(work.y, bounds.y), work.y + work.height - size.height);
    return { x, y, width: size.width, height: size.height };
}
function spotlightCenterBounds() {
    const display = electron_1.screen.getPrimaryDisplay().workArea;
    const { width, height } = panelWindowSize();
    return clampPresentedBounds({
        x: display.x + Math.round((display.width - width) / 2),
        y: display.y + Math.round((display.height - height) / 2) - 24,
        width,
        height,
    });
}
function clampPillBounds(bounds) {
    const display = electron_1.screen.getDisplayMatching(bounds);
    const work = display.workArea;
    const size = clampCompactSize(bounds.width, bounds.height, display);
    const x = Math.min(Math.max(work.x, bounds.x), work.x + work.width - size.width);
    const y = Math.min(Math.max(work.y, bounds.y), work.y + work.height - size.height);
    return { x, y, width: size.width, height: size.height };
}
function ensurePillOnScreen(bounds) {
    const display = electron_1.screen.getPrimaryDisplay();
    const work = display.workArea;
    const size = clampCompactSize(bounds.width, bounds.height, display);
    return {
        x: work.x + Math.round((work.width - size.width) / 2),
        y: work.y + 10,
        width: size.width,
        height: size.height,
    };
}
function syncPanelOpenState() {
    (0, childProcess_1.safeWriteStdin)(keyListenerProcess, panelMode === 'presented' ? 'PANEL_OPEN\n' : 'PANEL_CLOSED\n', 'key_listener');
}
function broadcastPanelMode() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('panel-mode', panelMode);
    }
}
function getNativeHwnd(win) {
    const buf = win.getNativeWindowHandle();
    if (buf.length >= 8) {
        return buf.readBigUInt64LE(0).toString();
    }
    return buf.readUInt32LE(0).toString();
}
function compactPillBackgroundColor() {
    return WIN32_OPAQUE_PILL ? PILL_BG_COLOR : '#00000000';
}
function presentedPanelBackgroundColor() {
    return WIN32_OPAQUE_PILL ? PANEL_BG_COLOR : '#00000000';
}
function ensurePillMouseInput() {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    mainWindow.setIgnoreMouseEvents(false);
}
function syncCompactPillLayer() {
    if (!mainWindow || mainWindow.isDestroyed() || panelMode !== 'compact')
        return;
    const shouldBeAlwaysOnTop = selectionActive || transientPillActive;
    if (shouldBeAlwaysOnTop) {
        mainWindow.setAlwaysOnTop(true, COMPACT_PILL_LEVEL, COMPACT_PILL_RELATIVE);
    }
    else {
        mainWindow.setAlwaysOnTop(false);
    }
    ensurePillMouseInput();
}
/** Compact pill: CSS capsule only. HWND clip + DWM tweaks break mouse input on Windows. */
function applyWindowShape(mode) {
    if (mode === 'compact') {
        syncCompactPillLayer();
        return;
    }
    if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed())
        return;
    const exe = path.join(__dirname, 'round_window.exe');
    if (!fs.existsSync(exe))
        return;
    const hwnd = getNativeHwnd(mainWindow);
    setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        mainWindow.setBackgroundColor(PANEL_BG_COLOR);
        for (const mode of ['panel', 'clear']) {
            const helper = (0, child_process_1.spawn)(exe, [hwnd, mode], { windowsHide: true });
            helper.once('error', (error) => {
                console.warn(`round_window ${mode} failed:`, error);
            });
        }
    }, 16);
}
function applyPanelBounds(bounds, mode) {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
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
function mainPagePath(page) {
    const file = page === 'pill' ? 'pill.html' : 'index.html';
    return path.join(electron_1.app.getAppPath(), file);
}
function clearTransientPillTimer() {
    if (transientPillTimer) {
        clearTimeout(transientPillTimer);
        transientPillTimer = null;
    }
}
function compactPillShouldBeVisible() {
    return (0, pillVisibility_1.shouldShowCompactPill)((0, pillVisibility_1.normalizePillVisibility)(settings.pillVisibility), { selectionActive, transientActive: transientPillActive });
}
function applyCompactPillVisibility() {
    if (panelMode !== 'compact' || shutdownStarted)
        return;
    if (useNativePillHud) {
        syncNativePillHud();
        return;
    }
    if (!isWindowUsable(mainWindow) || mainWindowPage !== 'pill')
        return;
    if (compactPillShouldBeVisible()) {
        mainWindow.show();
        syncCompactPillLayer();
    }
    else {
        mainWindow.hide();
    }
}
function activateTransientPill() {
    transientPillActive = true;
    clearTransientPillTimer();
    applyCompactPillVisibility();
    transientPillTimer = setTimeout(() => {
        transientPillTimer = null;
        transientPillActive = false;
        applyCompactPillVisibility();
    }, 4500);
}
function loadMainWindowPage(page) {
    if (!isWindowUsable(mainWindow))
        return Promise.resolve(false);
    if (useNativePillHud && page === 'pill')
        return Promise.resolve(true);
    const win = mainWindow;
    if (mainWindowPageLoad?.window === win && mainWindowPageLoad.page === page) {
        return mainWindowPageLoad.promise;
    }
    if (mainWindowPage === page && !mainWindowPageLoad)
        return Promise.resolve(true);
    const generation = ++mainWindowPageLoadGeneration;
    mainWindowPage = page;
    const promise = win
        .loadFile(mainPagePath(page))
        .then(() => mainWindow === win &&
        isWindowUsable(win) &&
        mainWindowPageLoadGeneration === generation &&
        mainWindowPage === page)
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
function presentSpotlight() {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    if (panelMode === 'presented') {
        mainWindow.focus();
        return;
    }
    if (useNativePillHud) {
        sendPillHudCommand('HIDE');
    }
    else {
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
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        applyPanelBounds(panelBounds, 'presented');
        mainWindow.show();
        mainWindow.focus();
        syncPanelOpenState();
        broadcastPanelMode();
    });
}
function dismissSpotlight(force = false) {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    if (panelMode === 'compact')
        return;
    if (!force && settings.panelPinned)
        return;
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
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        applyPanelBounds(pill, 'compact');
        syncPanelOpenState();
        broadcastPanelMode();
    });
}
/** Spotlight-style HUD: pill stays visible above the capture overlay for live status. */
function setHudCapturing(active) {
    if (useNativePillHud && panelMode === 'compact') {
        sendPillHudCommand(`CAPTURE:${active ? 1 : 0}`);
    }
    if (mainWindow && !mainWindow.isDestroyed() && mainWindowPage === 'pill') {
        mainWindow.webContents.send('hud-capturing', active);
    }
}
function hidePillForScreenshot() {
    if (panelMode === 'presented' && !settings.panelPinned) {
        dismissSpotlight();
        return;
    }
    if (useNativePillHud) {
        sendPillHudCommand('HIDE');
        return;
    }
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    if (panelMode === 'compact') {
        savedPillBounds = clampPillBounds(mainWindow.getBounds());
    }
    mainWindow.hide();
}
function showPillHudOverOverlay() {
    panelMode = 'compact';
    if (useNativePillHud) {
        syncNativePillHud();
        pillHudElevated = true;
        setHudCapturing(true);
        broadcastPanelMode();
        syncPanelOpenState();
        return;
    }
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    void loadMainWindowPage('pill').then(() => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        applyPanelBounds(clampPillBounds(savedPillBounds ?? getInitialPanelBounds()), 'compact');
        mainWindow.setAlwaysOnTop(true, PILL_HUD_LEVEL, PILL_HUD_RELATIVE);
        pillHudElevated = true;
        mainWindow.show();
        setHudCapturing(true);
        broadcastPanelMode();
        syncPanelOpenState();
    });
}
function restorePillHudLayer() {
    setHudCapturing(false);
    if (pillHudElevated) {
        pillHudElevated = false;
    }
    if (panelMode === 'compact' || settings.panelPinned) {
        if (useNativePillHud) {
            syncNativePillHud();
            return;
        }
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        mainWindow.show();
        syncCompactPillLayer();
    }
}
function toggleSpotlight() {
    if (panelMode === 'presented') {
        dismissSpotlight();
    }
    else {
        presentSpotlight();
    }
}
function resizeCompactPill(requestedWidth, requestedHeight) {
    if (panelMode !== 'compact')
        return;
    if (useNativePillHud) {
        const next = clampCompactSize(requestedWidth, requestedHeight);
        if (next.width === compactPillSize.width && next.height === compactPillSize.height)
            return;
        compactPillSize = next;
        sendPillHudCommand(`SIZE:${next.width}:${next.height}`);
        return;
    }
    if (!mainWindow ||
        mainWindow.isDestroyed() ||
        mainWindowPage !== 'pill') {
        return;
    }
    const prev = mainWindow.getBounds();
    const display = electron_1.screen.getDisplayMatching(prev);
    const next = clampCompactSize(requestedWidth, requestedHeight, display);
    if (next.width === compactPillSize.width && next.height === compactPillSize.height)
        return;
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
function persistPanelPosition() {
    if (useNativePillHud || !mainWindow || mainWindow.isDestroyed())
        return;
    if (panelMode !== 'compact')
        return;
    const bounds = clampPillBounds(mainWindow.getBounds());
    settings.panelX = bounds.x;
    settings.panelY = bounds.y;
    savedPillBounds = bounds;
    settingsStore.save();
}
function createMainWindow() {
    useNativePillHud = resolveNativePillHud();
    const initialBounds = getInitialPanelBounds();
    panelMode = 'compact';
    const startBounds = ensurePillOnScreen(initialBounds);
    savedPillBounds = startBounds;
    compactPillSize = { width: startBounds.width, height: startBounds.height };
    const panelSize = panelWindowSize();
    mainWindow = new electron_1.BrowserWindow({
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
            if (mainWindow &&
                !mainWindow.isDestroyed() &&
                !mainWindow.isFocused() &&
                panelMode === 'presented' &&
                !settings.panelPinned &&
                !selectionActive &&
                !selectionStarting &&
                !pillHudElevated) {
                dismissSpotlight();
            }
        }, 220);
    });
    mainWindow.webContents.on('did-finish-load', () => {
        broadcastPanelMode();
        if (!useNativePillHud &&
            mainWindow &&
            !mainWindow.isDestroyed() &&
            mainWindowPage === 'pill' &&
            panelMode === 'compact') {
            applyWindowShape('compact');
            applyCompactPillVisibility();
        }
        if (settings.panelPinned && panelMode !== 'presented') {
            presentSpotlight();
        }
    });
    mainWindow.once('ready-to-show', () => {
        if (!useNativePillHud &&
            panelMode === 'compact' &&
            mainWindow &&
            !mainWindow.isDestroyed() &&
            mainWindowPage === 'pill') {
            applyCompactPillVisibility();
        }
    });
    if (useNativePillHud) {
        mainWindowPage = 'none';
        startNativePillHud();
        console.log('Windows native pill HUD aktif (pill_hud.exe)');
    }
    else {
        mainWindowPage = 'pill';
        mainWindow.loadFile(mainPagePath('pill')).then(() => {
            if (panelMode === 'compact') {
                applyCompactPillVisibility();
            }
        }).catch(err => console.error('Pill page load failed:', err));
    }
}
function getVirtualBounds() {
    return (0, geometry_1.getVirtualBounds)(electron_1.screen.getAllDisplays());
}
function invalidateOverlayLifecycle() {
    clearPendingRenderWaiter();
    overlayGeneration += 1;
    if (overlayLifecycle) {
        overlayLifecycle.resolveRendererReady();
        overlayLifecycle = null;
    }
}
function ensureOverlayWindow() {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayLifecycle) {
        return overlayWindow;
    }
    invalidateOverlayLifecycle();
    const generation = overlayGeneration;
    const bounds = getVirtualBounds();
    overlayWindow = new electron_1.BrowserWindow({
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
    let resolveLoad;
    const loadPromise = new Promise((resolve) => {
        resolveLoad = resolve;
    });
    let resolveReady;
    const rendererReadyPromise = new Promise((resolve) => {
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
    overlayWindow.loadFile(path.join(electron_1.app.getAppPath(), 'src', 'overlay.html')).catch((err) => {
        console.error('Failed to load overlay html:', err);
    });
    return overlayWindow;
}
async function waitForOverlayReady(lifecycle) {
    await lifecycle.loadPromise;
    if (lifecycle.generation !== overlayGeneration || !isWindowUsable(lifecycle.window)) {
        throw new Error('Overlay generation changed during load');
    }
    await withTimeout(lifecycle.rendererReadyPromise, 2500, 'Overlay renderer initialization handshake timed out');
    if (lifecycle.generation !== overlayGeneration || !isWindowUsable(lifecycle.window)) {
        throw new Error('Overlay generation changed during handshake');
    }
}
// NOTE: status/response strings pushed from the main process (capture, AI, OCR,
// Supabase, phone-sync flows) are currently Turkish-only. The renderer shows them
// verbatim, so under an English UI these runtime lines stay Turkish. Static labels
// and the settings-screen actions ARE localized (see src/lib/i18n.ts); localizing
// the ~30 main-process call sites is a tracked low-priority follow-up that would
// touch the core capture path.
function setStatus(message) {
    const oneLine = message.replace(/\r?\n/g, ' ').trim();
    if (useNativePillHud && panelMode === 'compact') {
        sendPillHudCommand(`STATUS:${oneLine}`);
        sendPillHudCommand('ACTIVE');
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        const sendToRenderer = (mainWindowPage === 'panel' && panelMode === 'presented') ||
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
async function showSelectionOverlay(backgroundImagePath, bounds, sessionId) {
    const win = ensureOverlayWindow();
    if (!isWindowUsable(win))
        return;
    const currentGeneration = overlayGeneration;
    const lifecycle = overlayLifecycle;
    const windowPort = {
        setIgnoreMouseEvents: (ignore, options) => {
            if (isWindowUsable(win)) {
                win.setIgnoreMouseEvents(ignore, options);
            }
        },
        setBounds: (b) => {
            if (isWindowUsable(win)) {
                win.setBounds(b);
            }
        },
        sendOverlayState: (state) => {
            sendOverlayState(state);
        },
        showInactive: () => {
            if (isWindowUsable(win)) {
                win.showInactive();
            }
        },
    };
    const isCurrent = () => {
        return (isWindowUsable(win) &&
            overlayLifecycle === lifecycle &&
            overlayGeneration === currentGeneration &&
            selectionActive &&
            isSelectionSessionCurrent(sessionId));
    };
    const waitForReady = async () => {
        if (lifecycle && lifecycle.window === win) {
            await waitForOverlayReady(lifecycle);
        }
    };
    let activeRenderPromise = null;
    const prepareRenderWaiter = (sessId) => {
        if (pendingRenderWaiter) {
            pendingRenderWaiter.reject(new Error('Superseeded by new render waiter'));
            pendingRenderWaiter = null;
        }
        const renderPromise = new Promise((resolve, reject) => {
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
        }
        else {
            throw new Error('Render waiter was not prepared');
        }
    };
    await (0, overlayActivation_1.activateSelectionOverlay)({
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
function hideSelectionOverlay(sessionId) {
    clearPendingRenderWaiter();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
        sendOverlayState({ visible: false, active: false, selection: null, backgroundImage: null, sessionId });
        overlayWindow.hide();
    }
    restorePillHudLayer();
    applyCompactPillVisibility();
}
function setSelectionInstruction(message, sessionId) {
    if (overlayWindow && !overlayWindow.isDestroyed() && isSelectionSessionCurrent(sessionId)) {
        overlayWindow.webContents.send('overlay-message', message);
    }
}
function resetSelectionSession(sessionId) {
    if (sessionId !== selectionSessionId)
        return;
    selectionActive = false;
    selectionDragEnabled = false;
    selectionHasAnnotations = false;
    selectionRect = null;
    selectionDisplay = null;
    capturedScreenImage = null;
    (0, childProcess_1.safeWriteStdin)(keyListenerProcess, 'INACTIVE\n', 'key_listener');
}
function isSelectionSessionCurrent(sessionId) {
    return selectionSessionId === sessionId && !shutdownStarted;
}
function deleteSelectionDragFile(filePath) {
    if (!filePath)
        return;
    fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
            console.warn('Failed to delete temporary drag file:', err);
        }
    });
}
function getSelectionDragDirectory() {
    return path.join(electron_1.app.getPath('temp'), 'ctrl2phone-drag');
}
function cleanupStaleSelectionDragFiles() {
    const dragDir = getSelectionDragDirectory();
    const oldestAllowed = Date.now() - 10 * 60_000;
    try {
        if (!fs.existsSync(dragDir))
            return;
        for (const entry of fs.readdirSync(dragDir, { withFileTypes: true })) {
            if (!entry.isFile() || !/^(drag-|capture-).*\.png$/i.test(entry.name))
                continue;
            const filePath = path.join(dragDir, entry.name);
            try {
                if (fs.statSync(filePath).mtimeMs < oldestAllowed) {
                    fs.unlinkSync(filePath);
                }
            }
            catch {
                // ignore
            }
        }
    }
    catch (error) {
        console.warn('Selection drag temp cleanup failed:', error);
    }
}
function invalidateSelectionDragAsset() {
    selectionDragGeneration += 1;
    const stalePath = currentSelectionDragFilePath;
    currentSelectionDragFilePath = null;
    if (stalePath) {
        deleteSelectionDragFile(stalePath);
    }
}
function currentSelectionSnapshot(sessionId) {
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
function beginSelectionAction(sessionId) {
    if (!isSelectionSessionCurrent(sessionId))
        return null;
    selectionActionInFlightSessionId = sessionId;
    return sessionId;
}
function endSelectionAction(actionSessionId) {
    if (actionSessionId === selectionActionInFlightSessionId) {
        selectionActionInFlightSessionId = null;
    }
}
async function startSelectionSession() {
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
        const cursorPoint = electron_1.screen.getCursorScreenPoint();
        const activeDisplay = electron_1.screen.getDisplayNearestPoint(cursorPoint);
        selectionDisplay = activeDisplay;
        hidePillForScreenshot();
        const tScreenshotStart = Date.now();
        const availableDisplays = await screenshot_desktop_1.default.listDisplays();
        const captureDisplay = (0, screenCaptureSource_1.selectExternalCaptureDisplay)(availableDisplays, activeDisplay);
        if (!captureDisplay) {
            throw new Error(`Active display could not be mapped for capture: ${activeDisplay.id}`);
        }
        const imageBuffer = await (0, screenshot_desktop_1.default)({ format: 'png', screen: captureDisplay.id });
        const tScreenshotEnd = Date.now();
        console.log(`[PERF] [t1] Screenshot hazır (external display capture). Süre: ${tScreenshotEnd - tScreenshotStart}ms. Toplam süre: ${tScreenshotEnd - selectionSessionStartTime}ms`);
        if (!isSelectionSessionCurrent(sessionId) || shutdownStarted)
            return;
        capturedScreenImage = electron_1.nativeImage.createFromBuffer(imageBuffer);
        if (capturedScreenImage.isEmpty()) {
            throw new Error('Captured screen image is empty');
        }
        const previewBase64 = capturedScreenImage.toJPEG(82).toString('base64');
        const dataUrl = `data:image/jpeg;base64,${previewBase64}`;
        selectionActive = true;
        (0, childProcess_1.safeWriteStdin)(keyListenerProcess, 'ACTIVE\n', 'key_listener');
        selectionRect = null;
        const tShowOverlayStart = Date.now();
        await showSelectionOverlay(dataUrl, activeDisplay.bounds, sessionId);
        const tShowOverlayEnd = Date.now();
        console.log(`[PERF] [t2] showSelectionOverlay bitti. Süre: ${tShowOverlayEnd - tShowOverlayStart}ms. Toplam süre: ${tShowOverlayEnd - selectionSessionStartTime}ms`);
        if (!isSelectionSessionCurrent(sessionId) || shutdownStarted)
            return;
        showPillHudOverOverlay();
        setSelectionInstruction('Alanı seç → X/Enter: Gemini · M: Telefon · C: OCR · Esc: iptal', sessionId);
        setStatus('Seçim modu açık. Alanı fareyle çiz.');
    }
    catch (error) {
        console.error('Ekran yakalama hatası:', error);
        setStatus('Ekran yakalama başlatılamadı: ' + error.message);
        setHudCapturing(false);
        restorePillHudLayer();
        if (isSelectionSessionCurrent(sessionId)) {
            hideSelectionOverlay(sessionId);
            resetSelectionSession(sessionId);
        }
    }
    finally {
        if (selectionSessionId === sessionId) {
            selectionStarting = false;
        }
    }
}
function toAbsoluteRect(rect, displayBounds) {
    return (0, geometry_1.toAbsoluteRect)(rect, displayBounds);
}
function cropImageToSelection(image, rect, display) {
    const relative = (0, geometry_1.computeCropRect)(rect, display.bounds, image.getSize(), display.scaleFactor);
    return image.crop(relative);
}
async function getAnnotatedComposite(snapshot) {
    if (!snapshot.hasAnnotations || !isSelectionSessionCurrent(snapshot.sessionId) || !overlayWindow || overlayWindow.isDestroyed()) {
        return null;
    }
    try {
        const dataUrl = await overlayWindow.webContents.executeJavaScript('window.__ctrl2phoneCompose ? window.__ctrl2phoneCompose() : null');
        if (!isSelectionSessionCurrent(snapshot.sessionId))
            return null;
        if (dataUrl && typeof dataUrl === 'string') {
            const img = electron_1.nativeImage.createFromDataURL(dataUrl);
            if (!img.isEmpty()) {
                return img;
            }
        }
    }
    catch (e) {
        console.error('Annotation composite failed; using plain crop:', e);
    }
    return null;
}
async function resolveSelectionImage(snapshot) {
    const absoluteRect = toAbsoluteRect(snapshot.rect, snapshot.display.bounds);
    const clampedRect = (0, geometry_1.clampRectToDisplay)(absoluteRect, snapshot.display.bounds);
    if (clampedRect.width <= 0 || clampedRect.height <= 0)
        return null;
    const annotatedImage = await getAnnotatedComposite(snapshot);
    if (!isSelectionSessionCurrent(snapshot.sessionId))
        return null;
    return annotatedImage ?? cropImageToSelection(snapshot.image, clampedRect, snapshot.display);
}
async function updateSelectionDragAsset(sessionId) {
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
    }
    catch (err) {
        console.error('Failed to update selection drag asset:', err);
    }
}
function isImageEmptySafe(img) {
    try {
        return img.isEmpty();
    }
    catch {
        return true;
    }
}
// Candidate locations for a bundled native helper exe. process.resourcesPath
// (where electron-builder's extraResources land) must be checked first so the
// packaged build finds the exe; the later entries cover dev / npm start.
function helperExeCandidates(name) {
    return [
        path.join(process.resourcesPath, 'src', name),
        path.join(process.resourcesPath, name),
        path.join(__dirname, name),
        path.join(__dirname, '..', 'src', name),
        path.join(electron_1.app.getAppPath(), 'src', name),
    ];
}
function resolveNativePillHud() {
    // Always return false to use the HTML5/Electron compact pill HUD
    // so we can support drop-to-upload and drag-to-download folder features.
    return false;
}
function getPillHudPath() {
    for (const p of helperExeCandidates('pill_hud.exe')) {
        if (fs.existsSync(p))
            return p;
    }
    throw new Error('pill_hud.exe not found');
}
function sendPillHudCommand(command) {
    (0, childProcess_1.safeWriteStdin)(pillHudProcess, command + '\n', 'pill_hud');
}
function clearPillHudReadyTimer() {
    if (pillHudReadyTimer) {
        clearTimeout(pillHudReadyTimer);
        pillHudReadyTimer = null;
    }
}
function activateElectronPillFallback() {
    if (nativeHudDisabledForRun || shutdownStarted)
        return;
    console.warn('Native pill HUD failed to respond/start. Falling back to Electron compact pill HUD...');
    nativeHudDisabledForRun = true;
    useNativePillHud = false;
    stopNativePillHud();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindowPage = 'pill';
        mainWindow.setBackgroundColor(compactPillBackgroundColor());
        let resolveFallback;
        _pillHudFallbackInFlight = new Promise((resolve) => {
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
function syncNativePillHud(message) {
    if (!useNativePillHud || shutdownStarted)
        return;
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
function handlePillHudEvent(line) {
    if (line === 'PILL_READY') {
        clearPillHudReadyTimer();
        const ready = selectionActive
            ? 'Seçim modu açık'
            : (0, i18n_1.getStrings)((0, i18n_1.resolveLang)(settings.language, electron_1.app.getLocale()))['status.ready'] ?? 'Hazır';
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
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return;
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
            const display = savedPillBounds ? electron_1.screen.getDisplayMatching(savedPillBounds) : undefined;
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
function stopNativePillHud() {
    const proc = pillHudProcess;
    if (!proc)
        return;
    clearPillHudReadyTimer();
    intentionallyStoppedPillHuds.add(proc);
    pillHudProcess = null;
    try {
        proc.stdin?.end();
    }
    catch {
        // ignore
    }
    try {
        proc.kill();
    }
    catch {
        // ignore
    }
}
function startNativePillHud() {
    if (!useNativePillHud || shutdownStarted)
        return;
    stopNativePillHud();
    clearPillHudReadyTimer();
    try {
        const binaryPath = getPillHudPath();
        const proc = (0, child_process_1.spawn)(binaryPath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        pillHudProcess = proc;
        (0, childProcess_1.attachStdinErrorGuard)(proc, 'pill_hud');
        (0, childProcess_1.bindLineReader)(proc.stdout, (line) => {
            if (pillHudProcess === proc)
                handlePillHudEvent(line);
        });
        proc.stderr?.on('data', (chunk) => {
            console.warn('[pill_hud stderr]:', chunk.toString('utf8').trim());
        });
        proc.on('error', (err) => {
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
    }
    catch (err) {
        console.error('Native pill HUD başlatılamadı:', err);
        activateElectronPillFallback();
    }
}
function getKeyListenerPath() {
    const possiblePaths = helperExeCandidates('key_listener.exe');
    for (const p of possiblePaths) {
        if (fs.existsSync(p))
            return p;
    }
    throw new Error(`key_listener.exe not found at paths: ${possiblePaths.join(', ')}. Run: csc /nologo /reference:System.Windows.Forms.dll /target:exe /out:key_listener.exe key_listener.cs`);
}
// Photo dropper helper is no longer used since incoming downloads are directly
// displayed inside the folder list in the Electron compact pill HUD.
function startKeyListener() {
    try {
        stopKeyListener();
        const binaryPath = getKeyListenerPath();
        const proc = (0, child_process_1.spawn)(binaryPath, [], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        keyListenerProcess = proc;
        (0, childProcess_1.attachStdinErrorGuard)(proc, 'key_listener');
        (0, childProcess_1.bindLineReader)(proc.stdout, (line) => {
            if (keyListenerProcess === proc)
                handleGlobalKeyEvent(line);
        });
        proc.stderr?.on('data', (data) => {
            console.error('[key_listener stderr]', data.toString().trim());
        });
        proc.on('error', (err) => {
            console.error('Key listener process error:', err);
            if (keyListenerProcess === proc)
                setStatus('Klavye dinleyici başlatılamadı');
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
    }
    catch (err) {
        console.error('Failed to spawn key listener:', err);
        setStatus('Klavye dinleyici başlatılamadı');
    }
}
// Tell the C# listener which key to watch for and the double-press window.
function sendKeyListenerConfig() {
    const vk = settings.hotkeyVk || 0xa2;
    const ms = settings.doublePressMs || 400;
    (0, childProcess_1.safeWriteStdin)(keyListenerProcess, `CONFIG:${vk}:${ms}\n`, 'key_listener');
}
function stopKeyListener() {
    const proc = keyListenerProcess;
    if (!proc)
        return;
    keyListenerProcess = null;
    try {
        proc.stdin?.end();
    }
    catch {
        // ignore
    }
    try {
        proc.kill();
    }
    catch {
        // ignore — process may already be gone
    }
}
function handleGlobalKeyEvent(event) {
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
    }
    else if (event === 'KEY_X' || event === 'KEY_RETURN') {
        if (selectionActive) {
            if (!selectionRect) {
                setStatus('Önce fareyle bir alan seç.');
                return;
            }
            void captureAndSend(selectionSessionId);
        }
    }
    else if (event === 'KEY_M') {
        if (selectionActive) {
            if (!selectionRect) {
                setStatus('Önce fareyle bir alan seç.');
                return;
            }
            void captureAndSendToSupabase(selectionSessionId);
        }
    }
    else if (event === 'KEY_C') {
        if (selectionActive) {
            if (!selectionRect) {
                setStatus('Önce fareyle bir alan seç.');
                return;
            }
            console.log('KEY_C → OCR başlatılıyor');
            void captureAndOcr(selectionSessionId);
        }
    }
    else if (event === 'CTRL_SHIFT_V') {
        void sendClipboardToPhone();
    }
    else if (event === 'CTRL_SHIFT_SPACE') {
        toggleSpotlight();
    }
    else if (event === 'SPOTLIGHT_DISMISS') {
        dismissSpotlight();
    }
    else if (event === 'KEY_ESCAPE') {
        if (selectionActive) {
            const sid = selectionSessionId;
            hideSelectionOverlay(sid);
            resetSelectionSession(sid);
            setStatus('Seçim iptal edildi');
        }
    }
    else if (event === 'KEY_Q') {
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
async function captureAndSend(sessionId) {
    const snapshot = currentSelectionSnapshot(sessionId);
    if (!snapshot)
        return;
    const actionSessionId = beginSelectionAction(sessionId);
    if (actionSessionId === null)
        return;
    try {
        const croppedImage = await resolveSelectionImage(snapshot);
        if (!croppedImage || !isSelectionSessionCurrent(sessionId)) {
            return;
        }
        hideSelectionOverlay(sessionId);
        resetSelectionSession(sessionId);
        electron_1.clipboard.writeImage(croppedImage);
        if (isApiProviderConfigured()) {
            await analyzeWithApi(croppedImage, () => isSelectionSessionCurrent(sessionId) || actionSessionId === selectionActionInFlightSessionId);
            return;
        }
        const windowInstance = await geminiWindowController.open();
        if (!isSelectionSessionCurrent(sessionId) && actionSessionId !== selectionActionInFlightSessionId)
            return;
        const composerFocused = await geminiWindowController.focusComposer(windowInstance, settings.prompt);
        geminiWindowController.sendPasteShortcut(windowInstance);
        setResponse(`Seçilen alan Gemini web'e kopyalandı. ${composerFocused ? 'Yapıştırma denendi.' : 'Yapıştırma kısayolu gönderildi.'}`);
        setStatus("Seçilen görsel Gemini web'e yapıştırıldı");
        activateTransientPill();
    }
    catch (error) {
        if (isSelectionSessionCurrent(sessionId) || actionSessionId === selectionActionInFlightSessionId) {
            setResponse(`Hata: ${error.message}`);
            setStatus('Seçim veya yapıştırma sırasında hata');
            hideSelectionOverlay(sessionId);
            resetSelectionSession(sessionId);
        }
    }
    finally {
        endSelectionAction(actionSessionId);
    }
}
function isApiProviderConfigured() {
    if (settings.aiProvider === 'web')
        return false;
    if (settings.aiProvider === 'custom')
        return Boolean(settings.aiBaseUrl.trim());
    return Boolean(settings.aiApiKey.trim());
}
async function analyzeWithApi(image, isCurrent) {
    const provider = settings.aiProvider;
    const config = {
        provider: provider,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
        baseUrl: settings.aiBaseUrl,
    };
    const prompt = settings.prompt;
    setStatus('Yapay zeka analiz ediyor...');
    setResponse('Analiz ediliyor... (yanıt birazdan burada görünecek)');
    try {
        const pngBase64 = image.toPNG().toString('base64');
        const text = await (0, aiProviders_1.analyzeImage)(config, pngBase64, prompt);
        if (!isCurrent())
            return false;
        setResponse(text);
        setStatus(`Yanıt alındı (${provider})`);
        activateTransientPill();
        return true;
    }
    catch (error) {
        if (isCurrent()) {
            setResponse(`Yapay zeka hatası: ${error.message}`);
            setStatus('Yapay zeka isteği başarısız');
            activateTransientPill();
        }
        return false;
    }
}
async function captureAndOcr(sessionId) {
    if (ocrInFlight) {
        setStatus('OCR zaten çalışıyor, lütfen bekleyin...');
        return;
    }
    const snapshot = currentSelectionSnapshot(sessionId);
    if (!snapshot)
        return;
    const actionSessionId = beginSelectionAction(sessionId);
    if (actionSessionId === null)
        return;
    ocrInFlight = true;
    try {
        const croppedImage = await resolveSelectionImage(snapshot);
        if (!croppedImage || !isSelectionSessionCurrent(sessionId)) {
            return;
        }
        const pngBuffer = croppedImage.toPNG();
        hideSelectionOverlay(sessionId);
        resetSelectionSession(sessionId);
        (0, clipboardWrite_1.guardLocalClipboard)(45000);
        setStatus('Metin okunuyor (OCR)...');
        setResponse('OCR çalışıyor... (bitince otomatik panoya kopyalanacak)');
        const aiConfig = settings.aiProvider !== 'web'
            ? {
                provider: settings.aiProvider,
                apiKey: settings.aiApiKey,
                model: settings.aiModel,
                baseUrl: settings.aiBaseUrl,
            }
            : null;
        const { text, source } = await (0, ocr_1.extractTextFromImage)(pngBuffer, { aiConfig });
        if (actionSessionId !== selectionActionInFlightSessionId && !isSelectionSessionCurrent(sessionId)) {
            return;
        }
        if (!text.trim()) {
            setResponse('Seçilen alanda okunabilir metin bulunamadı.');
            setStatus('OCR tamamlandı - metin yok');
            activateTransientPill();
            return;
        }
        const copied = await (0, clipboardWrite_1.writeTextToClipboardReliable)(text);
        const preview = text.length > 500 ? text.substring(0, 500) + '...' : text;
        setResponse(preview);
        if (copied) {
            setStatus(source === 'windows'
                ? 'Metin panoya kopyalandı (Windows OCR) - Ctrl+V ile yapıştır'
                : `Metin panoya kopyalandı (${settings.aiProvider} OCR) - Ctrl+V ile yapıştır`);
        }
        else {
            setStatus('OCR metni üretildi ama panoya yazılamadı - metni response alanından kopyalayın');
            setResponse(`${preview}\n\n⚠️ Panoya otomatik kopyalanamadı. Yukarıdaki metni elle seçip kopyalayın.`);
        }
        activateTransientPill();
    }
    catch (error) {
        if (isSelectionSessionCurrent(sessionId) || actionSessionId === selectionActionInFlightSessionId) {
            console.error('OCR error:', error);
            setResponse(`OCR hatası: ${error.message}`);
            setStatus('Metin okunamadı');
            hideSelectionOverlay(sessionId);
            resetSelectionSession(sessionId);
            activateTransientPill();
        }
    }
    finally {
        ocrInFlight = false;
        endSelectionAction(actionSessionId);
    }
}
async function captureAndSendToSupabase(sessionId) {
    const snapshot = currentSelectionSnapshot(sessionId);
    if (!snapshot)
        return false;
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
    if (actionSessionId === null)
        return false;
    try {
        const croppedImage = await resolveSelectionImage(snapshot);
        if (!croppedImage || !isSelectionSessionCurrent(sessionId)) {
            return false;
        }
        const pngBuffer = croppedImage.toPNG();
        hideSelectionOverlay(sessionId);
        resetSelectionSession(sessionId);
        setStatus("Görsel Supabase'e yükleniyor...");
        const fileName = `screenshot_${(0, crypto_1.randomUUID)()}.png`;
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
        }
        catch {
            // ignore
        }
        if (actionSessionId !== selectionActionInFlightSessionId && !isSelectionSessionCurrent(sessionId)) {
            return false;
        }
        setResponse(shareUrl
            ? `Supabase'e başarıyla yüklendi!\nGörsel Adresi (7 gün geçerli):\n${shareUrl}`
            : "Supabase'e başarıyla yüklendi! Telefon uygulamasından görüntüleyebilirsin.");
        setStatus('Seçilen görsel telefona gönderildi (Supabase)');
        activateTransientPill();
        return true;
    }
    catch (error) {
        if (isSelectionSessionCurrent(sessionId) || actionSessionId === selectionActionInFlightSessionId) {
            console.error('Supabase upload error:', error);
            setResponse(`Hata: ${error.message}`);
            setStatus('Supabase yükleme hatası');
            hideSelectionOverlay(sessionId);
            resetSelectionSession(sessionId);
            activateTransientPill();
        }
        return false;
    }
    finally {
        endSelectionAction(actionSessionId);
    }
}
electron_1.ipcMain.handle('save-settings', (_, nextSettings) => {
    if (shutdownStarted)
        return { ok: false };
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
electron_1.ipcMain.handle('copy-selection', async (event, sessionId) => {
    const ports = {
        isSenderAuthorized: () => {
            return overlayWindow !== null && !overlayWindow.isDestroyed() && event.sender === overlayWindow.webContents;
        },
        isSessionCurrent: () => {
            return isSelectionSessionCurrent(sessionId);
        },
        getSelectionImage: async () => {
            const snapshot = currentSelectionSnapshot(sessionId);
            if (!snapshot)
                return null;
            return await resolveSelectionImage(snapshot);
        },
        writeImageToClipboard: (image) => {
            electron_1.clipboard.writeImage(image);
        },
        readImageFromClipboard: () => {
            return electron_1.clipboard.readImage();
        },
        setStatus: (msg) => {
            setStatus(msg);
        },
        onSuccess: () => {
            invalidateSelectionDragAsset();
            hideSelectionOverlay(sessionId);
            resetSelectionSession(sessionId);
        },
    };
    return await (0, copySelection_1.executeCopySelection)(ports);
});
electron_1.ipcMain.handle('set-selection', (_, payload) => {
    if (!selectionActive || payload?.sessionId !== selectionSessionId) {
        return { ok: false };
    }
    if (payload?.type === 'start') {
        invalidateSelectionDragAsset();
        selectionRect = null;
        return { ok: true };
    }
    if (payload?.type === 'update') {
        const rect = payload.rect;
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
        selectionDisplay ??= electron_1.screen.getDisplayNearestPoint(electron_1.screen.getCursorScreenPoint());
        hidePillForScreenshot();
        if (selectionDragEnabled) {
            void updateSelectionDragAsset(payload.sessionId);
        }
        return { ok: true };
    }
    return { ok: false };
});
electron_1.ipcMain.handle('cancel-selection', (_, sessionId) => {
    if (!selectionActive || sessionId !== selectionSessionId)
        return { ok: false };
    hideSelectionOverlay(sessionId);
    resetSelectionSession(sessionId);
    setStatus('Seçim iptal edildi');
    return { ok: true };
});
electron_1.ipcMain.handle('set-annotated', (_, payload) => {
    if (!selectionActive || payload?.sessionId !== selectionSessionId)
        return { ok: false };
    invalidateSelectionDragAsset();
    selectionHasAnnotations = Boolean(payload.hasAnnotations);
    if (selectionDragEnabled) {
        void updateSelectionDragAsset(payload.sessionId);
    }
    return { ok: true };
});
electron_1.ipcMain.handle('confirm-selection-gemini', async (_, sessionId) => {
    if (selectionActive && selectionRect && sessionId === selectionSessionId) {
        await captureAndSend(sessionId);
        return { ok: true };
    }
    return { ok: false };
});
electron_1.ipcMain.handle('confirm-selection-phone', async (_, sessionId) => {
    if (selectionActive && selectionRect && sessionId === selectionSessionId) {
        await captureAndSendToSupabase(sessionId);
        return { ok: true };
    }
    return { ok: false };
});
electron_1.ipcMain.handle('confirm-selection-ocr', async (_, sessionId) => {
    if (selectionActive && selectionRect && sessionId === selectionSessionId) {
        await captureAndOcr(sessionId);
        return { ok: true };
    }
    return { ok: false };
});
electron_1.ipcMain.handle('get-storage-usage', async () => {
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
        if (error)
            throw error;
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
        let toPcFiles = [];
        try {
            const { data: toPc, error: toPcError } = await context.client.storage
                .from(context.bucket)
                .list('to_pc', {
                limit: 1000,
            });
            if (!toPcError && toPc)
                toPcFiles = toPc;
        }
        catch {
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
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
});
electron_1.ipcMain.handle('purge-storage', async () => {
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
        if (rootError)
            throw rootError;
        if (!isSupabaseContextCurrent(context)) {
            throw new Error('Supabase configuration changed during storage purge');
        }
        const filesToDelete = [];
        if (rootFiles) {
            for (const f of rootFiles) {
                if (f.name !== 'to_pc' && f.name !== '.keep' && !f.name.startsWith('.')) {
                    filesToDelete.push(f.name);
                }
            }
        }
        let toPcFiles = [];
        try {
            const { data: toPc, error: toPcError } = await context.client.storage
                .from(context.bucket)
                .list('to_pc', {
                limit: 1000,
            });
            if (!toPcError && toPc)
                toPcFiles = toPc;
        }
        catch {
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
            if (removeError)
                throw removeError;
        }
        return { ok: true, deletedCount: filesToDelete.length };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
    finally {
        if (storagePurgeInFlightGeneration === context.generation) {
            storagePurgeInFlightGeneration = null;
        }
    }
});
// ── Auto-updater ────────────────────────────────────────────────────────────
electron_updater_1.autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
});
electron_updater_1.autoUpdater.on('update-available', () => {
    console.log('Update available.');
});
electron_updater_1.autoUpdater.on('update-not-available', () => {
    console.log('Update not available.');
});
electron_updater_1.autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater:', err);
});
electron_updater_1.autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded; will install on quit');
});
// Last-resort safety net so a stray rejection never tears the app down silently.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
electron_1.ipcMain.handle('app-ready', () => {
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
            i18n: (0, i18n_1.getStrings)((0, i18n_1.resolveLang)(settings.language, electron_1.app.getLocale())),
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
        i18n: (0, i18n_1.getStrings)((0, i18n_1.resolveLang)(settings.language, electron_1.app.getLocale())),
        selectionActive,
        pillVisibility: (0, pillVisibility_1.normalizePillVisibility)(settings.pillVisibility),
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
electron_1.ipcMain.handle('panel-interact-start', () => {
    if (shutdownStarted)
        return { ok: false };
    syncCompactPillLayer();
    if (mainWindow && !mainWindow.isDestroyed() && panelMode === 'compact') {
        mainWindow.focus();
    }
    return { ok: true };
});
electron_1.ipcMain.handle('panel-toggle', () => {
    if (shutdownStarted)
        return { ok: false };
    toggleSpotlight();
    return { ok: true, mode: panelMode };
});
electron_1.ipcMain.handle('panel-drag-by', (_, dx, dy) => {
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
electron_1.ipcMain.handle('panel-dismiss', () => {
    if (shutdownStarted)
        return { ok: false };
    dismissSpotlight(true);
    return { ok: true, mode: panelMode };
});
electron_1.ipcMain.handle('panel-resize-compact', (_, size) => {
    if (shutdownStarted)
        return { ok: false };
    const width = typeof size?.width === 'number' ? size.width : PILL_DEFAULT.width;
    const height = typeof size?.height === 'number' ? size.height : PILL_DEFAULT.height;
    resizeCompactPill(width, height);
    return { ok: true, width: compactPillSize.width, height: compactPillSize.height };
});
electron_1.ipcMain.handle('panel-save-pinned', (_, pinned) => {
    if (shutdownStarted)
        return { ok: false };
    settings.panelPinned = Boolean(pinned);
    settingsStore.save();
    if (pinned) {
        presentSpotlight();
    }
    else {
        dismissSpotlight();
    }
    return { ok: true };
});
electron_1.ipcMain.handle('send-clipboard', async () => {
    if (shutdownStarted)
        return { ok: false };
    return sendClipboardToPhone();
});
electron_1.ipcMain.handle('generate-qr', async () => {
    if (shutdownStarted)
        return { ok: false };
    try {
        if (!settings.supabaseUrl || !settings.supabaseKey) {
            return { ok: false, error: 'Supabase ayarları eksik' };
        }
        const data = JSON.stringify({
            url: settings.supabaseUrl,
            key: settings.supabaseKey,
            bucket: settings.supabaseBucket || 'screenshots',
        });
        const dataUrl = await qrcode_1.default.toDataURL(data);
        return { ok: true, dataUrl };
    }
    catch (error) {
        console.error('QR Kod oluşturma hatası:', error);
        return { ok: false, error: error.message };
    }
});
electron_1.ipcMain.handle('setup-rls', async () => {
    if (shutdownStarted)
        return { ok: false };
    try {
        const bucket = settings.supabaseBucket || 'screenshots';
        const sql = (0, supabaseSetup_1.buildRlsSetupSql)(bucket);
        await (0, clipboardWrite_1.writeTextToClipboardReliable)(sql);
        let projectRef = '_';
        if (settings.supabaseUrl) {
            const match = settings.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/i);
            if (match) {
                projectRef = match[1];
            }
        }
        await electron_1.shell.openExternal(`https://supabase.com/dashboard/project/${projectRef}/sql/new`);
        return { ok: true, sql };
    }
    catch (error) {
        console.error('RLS kurulum hatası:', error);
        return { ok: false, error: error.message };
    }
});
electron_1.ipcMain.handle('open-gemini', async () => {
    if (shutdownStarted)
        return { ok: false };
    const windowInstance = await geminiWindowController.open();
    return { ok: Boolean(windowInstance) };
});
electron_1.ipcMain.handle('focus-gemini', async () => {
    if (shutdownStarted)
        return { ok: false };
    const windowInstance = await geminiWindowController.open();
    return { ok: Boolean(windowInstance) };
});
electron_1.ipcMain.handle('capture-now', async () => {
    if (shutdownStarted)
        return { ok: false };
    if (!selectionActive) {
        void startSelectionSession();
        return { ok: true, mode: 'selection-opened' };
    }
    void captureAndSend(selectionSessionId);
    return { ok: true };
});
electron_1.ipcMain.handle('overlay-renderer-ready', (event) => {
    if (overlayWindow && event.sender === overlayWindow.webContents) {
        const lifecycle = overlayLifecycle;
        if (lifecycle && lifecycle.window === overlayWindow) {
            lifecycle.rendererReady = true;
            lifecycle.resolveRendererReady();
        }
    }
    return { ok: true };
});
electron_1.ipcMain.handle('overlay-rendered', (event, sessionId) => {
    if (!overlayWindow || event.sender !== overlayWindow.webContents)
        return { ok: false };
    if (!isSelectionSessionCurrent(sessionId))
        return { ok: false };
    if (pendingRenderWaiter) {
        if (pendingRenderWaiter.sessionId === sessionId &&
            pendingRenderWaiter.generation === overlayGeneration) {
            pendingRenderWaiter.resolve();
            pendingRenderWaiter = null;
            console.log(`[PERF] [t3] Renderer rendered selection overlay for sessionId: ${sessionId}. Toplam süre: ${Date.now() - selectionSessionStartTime}ms`);
            return { ok: true };
        }
    }
    return { ok: false };
});
electron_1.ipcMain.handle('app-quit', () => {
    quitApplication();
    return { ok: true };
});
electron_1.ipcMain.on('start-selection-drag', (event, sessionId) => {
    const win = overlayWindow;
    if (!win || win.isDestroyed() || event.sender !== win.webContents)
        return;
    if (!isSelectionSessionCurrent(sessionId))
        return;
    const result = (0, selectionElectronDrag_1.executeSelectionElectronDrag)({
        getAsset: () => {
            const filePath = currentSelectionDragFilePath;
            if (!filePath || !fs.existsSync(filePath))
                return null;
            const sourceIcon = electron_1.nativeImage.createFromPath(filePath);
            if (sourceIcon.isEmpty())
                return null;
            const previewSize = (0, selectionElectronDrag_1.calculateDragPreviewSize)(sourceIcon.getSize(), {
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
async function uploadFileToPhone(filePath) {
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
        }
        catch {
            // ignore
        }
        setResponse(shareUrl
            ? `Telefona başarıyla yüklendi!\nDosya Adresi (7 gün geçerli):\n${shareUrl}`
            : 'Telefona başarıyla yüklendi! Telefon uygulamasından görüntüleyebilirsin.');
        setStatus('Dosya telefona gönderildi');
        activateTransientPill();
        return true;
    }
    catch (error) {
        console.error('Failed to upload file to phone:', error);
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Yükleme başarısız: ${message}`);
        activateTransientPill();
        return false;
    }
}
function isMainWindowSender(sender) {
    return isWindowUsable(mainWindow) && sender === mainWindow.webContents;
}
function resolveMainWindowDownload(sender, requestedPath) {
    if (!isMainWindowSender(sender))
        return null;
    return (0, downloadedFileAccess_1.resolveApprovedDownloadedFile)(requestedPath, downloadedPhoneFiles);
}
electron_1.ipcMain.handle('upload-file-to-phone', async (event, filePath) => {
    if (shutdownStarted || !isMainWindowSender(event.sender) || typeof filePath !== 'string') {
        return { ok: false };
    }
    const ok = await uploadFileToPhone(filePath);
    return { ok };
});
electron_1.ipcMain.on('start-drag-downloaded-file', (event, requestedPath) => {
    if (shutdownStarted)
        return;
    const filePath = resolveMainWindowDownload(event.sender, requestedPath);
    if (!filePath)
        return;
    console.log('[main.ts] start-drag-downloaded-file:', filePath);
    let icon = electron_1.nativeImage.createFromPath(filePath);
    if (icon.isEmpty()) {
        icon = electron_1.nativeImage.createFromBuffer(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
            0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
            0x42, 0x60, 0x82
        ]));
    }
    else {
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
    }
    catch (error) {
        console.error('startDrag for downloaded file failed:', error);
    }
});
electron_1.ipcMain.handle('delete-downloaded-file', async (event, requestedPath) => {
    if (shutdownStarted)
        return { ok: false };
    const filePath = resolveMainWindowDownload(event.sender, requestedPath);
    if (!filePath)
        return { ok: false };
    try {
        await fs.promises.unlink(filePath);
    }
    catch (error) {
        console.error('Failed to delete downloaded phone file:', error);
        return { ok: false };
    }
    downloadedPhoneFiles = downloadedPhoneFiles.filter(p => p !== filePath);
    broadcastPhoneDownloads();
    return { ok: true };
});
function showCustomNotification(title, body, type = 'info') {
    notificationController.show(title, body, type);
}
// ── Auto-updater ────────────────────────────────────────────────────────────
electron_updater_1.autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
});
electron_updater_1.autoUpdater.on('update-available', () => {
    console.log('Update available.');
});
electron_updater_1.autoUpdater.on('update-not-available', () => {
    console.log('Update not available.');
});
electron_updater_1.autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater:', err);
});
electron_updater_1.autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded; will install on quit');
});
// Last-resort safety net so a stray rejection never tears the app down silently.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (!shutdownStarted) {
            if (isWindowUsable(mainWindow)) {
                if (mainWindow.isMinimized())
                    mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
    electron_1.app.whenReady().then(() => {
        settingsStore.load();
        phoneSyncState.load();
        settingsStore.migrateLegacyPillVisibility();
        createMainWindow();
        try {
            startKeyListener();
        }
        catch (err) {
            console.error('Klavye dinleyici başlatılamadı:', err);
            setStatus('Klavye dinleyici bulunamadı (key_listener.exe derlenmemiş olabilir).');
        }
        cleanupStaleSelectionDragFiles();
        setupPhoneSyncPolling();
        setupClipboardPolling();
        setTimeout(() => {
            if (!shutdownStarted) {
                geminiWindowController
                    .ensureLoaded()
                    .catch((e) => console.error('Gemini ön-yükleme hatası:', e));
            }
        }, 5000);
        const isPacked = electron_1.app.isPackaged;
        const forceDevUpdate = false;
        if (isPacked || forceDevUpdate) {
            electron_updater_1.autoUpdater
                .checkForUpdatesAndNotify()
                .catch((e) => console.error('Güncelleme kontrolü başarısız:', e));
        }
        else {
            console.log('Skip checkForUpdates because application is not packed and dev update config is not forced');
        }
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });
    });
}
electron_1.app.on('before-quit', () => {
    if (beginShutdown()) {
        // Let the asynchronous teardown process complete
    }
});
electron_1.app.on('will-quit', () => {
    // Teardown is fully handled in beginShutdown
    if (_pillHudFallbackInFlight) { /* ignore */ }
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
