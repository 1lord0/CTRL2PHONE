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
  setAnnotated: (hasAnnotations) => ipcRenderer.invoke('set-annotated', hasAnnotations),
  onStatus: (callback) => ipcRenderer.on('status', (_, message) => callback(message)),
  onResponse: (callback) => ipcRenderer.on('response', (_, message) => callback(message)),
  onOverlayState: (callback) => ipcRenderer.on('overlay-state', (_, state) => callback(state)),
  onOverlayMessage: (callback) =>
    ipcRenderer.on('overlay-message', (_, message) => callback(message)),
  confirmSelectionGemini: () => ipcRenderer.invoke('confirm-selection-gemini'),
  confirmSelectionPhone: () => ipcRenderer.invoke('confirm-selection-phone'),
  confirmSelectionOcr: () => ipcRenderer.invoke('confirm-selection-ocr'),
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),
  purgeStorage: () => ipcRenderer.invoke('purge-storage'),
  setupRls: () => ipcRenderer.invoke('setup-rls'),
  sendClipboard: () => ipcRenderer.invoke('send-clipboard'),
  panelToggle: () => ipcRenderer.invoke('panel-toggle'),
  panelInteractStart: () => ipcRenderer.invoke('panel-interact-start'),
  panelDragBy: (dx, dy) => ipcRenderer.invoke('panel-drag-by', dx, dy),
  panelDismiss: () => ipcRenderer.invoke('panel-dismiss'),
  savePanelPinned: (pinned) => ipcRenderer.invoke('panel-save-pinned', pinned),
  panelResizeCompact: (size) => ipcRenderer.invoke('panel-resize-compact', size),
  onPanelMode: (callback) => ipcRenderer.on('panel-mode', (_, mode) => callback(mode)),
  onHudCapturing: (callback) => ipcRenderer.on('hud-capturing', (_, active) => callback(active)),
  onPillDragState: (callback) => ipcRenderer.on('pill-drag-state', (_, dragging) => callback(dragging)),
  onPillResized: (callback) => ipcRenderer.on('pill-resized', (_, size) => callback(size)),
};

contextBridge.exposeInMainWorld('bridge', bridge);
