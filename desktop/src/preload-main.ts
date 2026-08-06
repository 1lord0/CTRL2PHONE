import { contextBridge, ipcRenderer } from 'electron';
import type { MainBridgeAPI } from './types';

const bridge: MainBridgeAPI = {
  ready: () => ipcRenderer.invoke('app-ready'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  generateQr: () => ipcRenderer.invoke('generate-qr'),
  captureNow: () => ipcRenderer.invoke('capture-now'),
  openGemini: () => ipcRenderer.invoke('open-gemini'),
  focusGemini: () => ipcRenderer.invoke('focus-gemini'),
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),
  purgeStorage: () => ipcRenderer.invoke('purge-storage'),
  setupRls: () => ipcRenderer.invoke('setup-rls'),
  sendClipboard: () => ipcRenderer.invoke('send-clipboard'),
  panelToggle: () => ipcRenderer.invoke('panel-toggle'),
  panelInteractStart: () => ipcRenderer.invoke('panel-interact-start'),
  panelDragBy: (dx, dy) => ipcRenderer.invoke('panel-drag-by', dx, dy),
  panelDismiss: () => ipcRenderer.invoke('panel-dismiss'),
  quitApp: () => ipcRenderer.invoke('app-quit'),
  savePanelPinned: (pinned) => ipcRenderer.invoke('panel-save-pinned', pinned),
  panelResizeCompact: (size) => ipcRenderer.invoke('panel-resize-compact', size),
  onPanelMode: (callback) => ipcRenderer.on('panel-mode', (_, mode) => callback(mode)),
  onHudCapturing: (callback) => ipcRenderer.on('hud-capturing', (_, active) => callback(active)),
  onPillDragState: (callback) =>
    ipcRenderer.on('pill-drag-state', (_, dragging) => callback(dragging)),
  onPillResized: (callback) => ipcRenderer.on('pill-resized', (_, size) => callback(size)),
  onStatus: (callback) => ipcRenderer.on('status', (_, message) => callback(message)),
  onResponse: (callback) => ipcRenderer.on('response', (_, message) => callback(message)),
  onOverlayMessage: (callback) =>
    ipcRenderer.on('overlay-message', (_, message) => callback(message)),
  uploadFileToPhone: (filePath) => ipcRenderer.invoke('upload-file-to-phone', filePath),
  startDragDownloadedFile: (filePath) => ipcRenderer.send('start-drag-downloaded-file', filePath),
  deleteDownloadedFile: (filePath) => ipcRenderer.invoke('delete-downloaded-file', filePath),
  logUserAction: (action, details) => ipcRenderer.send('diagnostics-user-action', action, details),
  onPhoneDownloadsUpdated: (callback) =>
    ipcRenderer.on('phone-downloads-updated', (_, files) => callback(files)),
};

contextBridge.exposeInMainWorld('bridge', bridge);
