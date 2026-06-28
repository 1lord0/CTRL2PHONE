"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const bridge = {
    ready: () => electron_1.ipcRenderer.invoke('app-ready'),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke('save-settings', settings),
    generateQr: () => electron_1.ipcRenderer.invoke('generate-qr'),
    captureNow: () => electron_1.ipcRenderer.invoke('capture-now'),
    openGemini: () => electron_1.ipcRenderer.invoke('open-gemini'),
    focusGemini: () => electron_1.ipcRenderer.invoke('focus-gemini'),
    setSelection: (payload) => electron_1.ipcRenderer.invoke('set-selection', payload),
    cancelSelection: () => electron_1.ipcRenderer.invoke('cancel-selection'),
    setAnnotated: (hasAnnotations) => electron_1.ipcRenderer.invoke('set-annotated', hasAnnotations),
    onStatus: (callback) => electron_1.ipcRenderer.on('status', (_, message) => callback(message)),
    onResponse: (callback) => electron_1.ipcRenderer.on('response', (_, message) => callback(message)),
    onOverlayState: (callback) => electron_1.ipcRenderer.on('overlay-state', (_, state) => callback(state)),
    onOverlayMessage: (callback) => electron_1.ipcRenderer.on('overlay-message', (_, message) => callback(message)),
    confirmSelectionGemini: () => electron_1.ipcRenderer.invoke('confirm-selection-gemini'),
    confirmSelectionPhone: () => electron_1.ipcRenderer.invoke('confirm-selection-phone'),
    getStorageUsage: () => electron_1.ipcRenderer.invoke('get-storage-usage'),
    purgeStorage: () => electron_1.ipcRenderer.invoke('purge-storage'),
    setupRls: () => electron_1.ipcRenderer.invoke('setup-rls'),
    sendClipboard: () => electron_1.ipcRenderer.invoke('send-clipboard'),
};
electron_1.contextBridge.exposeInMainWorld('bridge', bridge);
