const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  ready: () => ipcRenderer.invoke('app-ready'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  generateQr: () => ipcRenderer.invoke('generate-qr'),
  captureNow: () => ipcRenderer.invoke('capture-now'),
  openGemini: () => ipcRenderer.invoke('open-gemini'),
  setSelection: (payload) => ipcRenderer.invoke('set-selection', payload),
  cancelSelection: () => ipcRenderer.invoke('cancel-selection'),
  onStatus: (callback) => ipcRenderer.on('status', (_, message) => callback(message)),
  onResponse: (callback) => ipcRenderer.on('response', (_, message) => callback(message)),
  onOverlayState: (callback) => ipcRenderer.on('overlay-state', (_, state) => callback(state)),
  onOverlayMessage: (callback) => ipcRenderer.on('overlay-message', (_, message) => callback(message)),
});