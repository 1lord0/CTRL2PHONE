import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeAPI } from './types';

const bridge: BridgeAPI = {
  ready: () => ipcRenderer.invoke('app-ready'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  generateQr: () => ipcRenderer.invoke('generate-qr'),
  captureNow: () => ipcRenderer.invoke('capture-now'),
  openGemini: () => ipcRenderer.invoke('open-gemini'),
  focusGemini: () => ipcRenderer.invoke('focus-gemini'),
  setSelection: (payload) => ipcRenderer.invoke('set-selection', payload),
  cancelSelection: () => ipcRenderer.invoke('cancel-selection'),
  onStatus: (callback) => ipcRenderer.on('status', (_, message) => callback(message)),
  onResponse: (callback) => ipcRenderer.on('response', (_, message) => callback(message)),
  onOverlayState: (callback) => ipcRenderer.on('overlay-state', (_, state) => callback(state)),
  onOverlayMessage: (callback) =>
    ipcRenderer.on('overlay-message', (_, message) => callback(message)),
  confirmSelectionGemini: () => ipcRenderer.invoke('confirm-selection-gemini'),
  confirmSelectionPhone: () => ipcRenderer.invoke('confirm-selection-phone'),
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),
  purgeStorage: () => ipcRenderer.invoke('purge-storage'),
  sendClipboard: () => ipcRenderer.invoke('send-clipboard'),
};

contextBridge.exposeInMainWorld('bridge', bridge);
