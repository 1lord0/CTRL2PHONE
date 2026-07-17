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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotificationController = createNotificationController;
exports.createElectronNotificationController = createElectronNotificationController;
const electron_1 = require("electron");
const path = __importStar(require("path"));
function createNotificationController(ports) {
    let window = null;
    let pending = null;
    let rendererReady = false;
    let generation = 0;
    let dismissTimer = null;
    let closeTimer = null;
    const clearTimers = () => {
        if (dismissTimer)
            clearTimeout(dismissTimer);
        if (closeTimer)
            clearTimeout(closeTimer);
        dismissTimer = null;
        closeTimer = null;
    };
    const display = (target, currentGeneration, payload) => {
        target.webContents.send('notification-data', payload);
        if (dismissTimer)
            clearTimeout(dismissTimer);
        dismissTimer = setTimeout(() => {
            dismissTimer = null;
            if (window !== target || generation !== currentGeneration || ports.isShutdown())
                return;
            target.webContents.send('notification-dismiss');
            if (closeTimer)
                clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
                closeTimer = null;
                if (window === target && generation === currentGeneration && !ports.isShutdown()) {
                    target.hide();
                }
            }, 500);
        }, 3500);
    };
    const createWindow = (payload) => {
        pending = payload;
        const target = ports.createWindow();
        window = target;
        rendererReady = false;
        target.setAlwaysOnTop(true, 'screen-saver');
        const currentGeneration = ++generation;
        target.webContents.once('did-finish-load', () => {
            rendererReady = true;
            if (window !== target ||
                generation !== currentGeneration ||
                pending === null ||
                ports.isShutdown()) {
                return;
            }
            const nextPayload = pending;
            pending = null;
            target.show();
            display(target, currentGeneration, nextPayload);
        });
        void ports.loadWindow(target).catch((error) => {
            if (!(error instanceof Error))
                throw error;
            ports.logLoadError(error);
        });
        target.on('closed', () => {
            if (window !== target)
                return;
            window = null;
            rendererReady = false;
        });
    };
    const show = (title, body, type = 'info') => {
        if (ports.isShutdown())
            return;
        const payload = { title, body, type };
        if (window === null || window.isDestroyed()) {
            createWindow(payload);
            return;
        }
        const currentGeneration = ++generation;
        clearTimers();
        if (rendererReady && !window.isDestroyed() && !ports.isShutdown()) {
            pending = null;
            window.show();
            display(window, currentGeneration, payload);
        }
        else {
            pending = payload;
        }
    };
    const shutdown = () => {
        generation += 1;
        pending = null;
        clearTimers();
    };
    return { show, shutdown };
}
function createElectronNotificationController(isShutdown) {
    return createNotificationController({
        isShutdown,
        createWindow: () => {
            const workArea = electron_1.screen.getPrimaryDisplay().workArea;
            const width = 360;
            const height = 90;
            return new electron_1.BrowserWindow({
                x: workArea.x + workArea.width - width - 16,
                y: workArea.y + 16,
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
                    preload: path.join(__dirname, '..', 'preload.js'),
                    contextIsolation: true,
                    nodeIntegration: false,
                },
            });
        },
        loadWindow: window => window.loadFile(path.join(electron_1.app.getAppPath(), 'src', 'notification.html')).then(() => undefined),
        logLoadError: error => console.error('Failed to load notification file:', error),
    });
}
