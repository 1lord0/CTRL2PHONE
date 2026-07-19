import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayBridgeAPI } from './types';

const bridge: OverlayBridgeAPI = {
  notifyOverlayReady: () => ipcRenderer.invoke('overlay-renderer-ready'),
  notifyOverlayRendered: (sessionId) => ipcRenderer.invoke('overlay-rendered', sessionId),
  setSelection: (payload) => ipcRenderer.invoke('set-selection', payload),
  cancelSelection: (sessionId) => ipcRenderer.invoke('cancel-selection', sessionId),
  setAnnotated: (payload) => ipcRenderer.invoke('set-annotated', payload),
  startSelectionDrag: (sessionId) => ipcRenderer.send('start-selection-drag', sessionId),
  onSelectionDragState: (callback) =>
    ipcRenderer.on('selection-drag-state', (_, data) => callback(data)),
  copySelection: (sessionId) => ipcRenderer.invoke('copy-selection', sessionId),
  onOverlayState: (callback) => ipcRenderer.on('overlay-state', (_, state) => callback(state)),
  onOverlayMessage: (callback) =>
    ipcRenderer.on('overlay-message', (_, message) => callback(message)),
  confirmSelectionGemini: (sessionId) => ipcRenderer.invoke('confirm-selection-gemini', sessionId),
  confirmSelectionPhone: (sessionId) => ipcRenderer.invoke('confirm-selection-phone', sessionId),
  confirmSelectionOcr: (sessionId) => ipcRenderer.invoke('confirm-selection-ocr', sessionId),
};

contextBridge.exposeInMainWorld('bridge', bridge);
