import { contextBridge, ipcRenderer } from 'electron';
import type { NotificationBridgeAPI } from './types';

const bridge: NotificationBridgeAPI = {
  onNotification: (callback) => ipcRenderer.on('notification-data', (_, data) => callback(data)),
  onDismissNotification: (callback) => ipcRenderer.on('notification-dismiss', () => callback()),
};

contextBridge.exposeInMainWorld('bridge', bridge);
