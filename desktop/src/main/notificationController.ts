import { app, BrowserWindow, screen } from 'electron';
import * as path from 'path';

export type NotificationType = 'success' | 'info' | 'error' | 'sync';

export interface NotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly type: NotificationType;
}

export interface NotificationWindow {
  readonly webContents: {
    readonly send: (channel: string, payload?: unknown) => void;
    readonly once: (event: 'did-finish-load', listener: () => void) => void;
  };
  readonly isDestroyed: () => boolean;
  readonly show: () => void;
  readonly hide: () => void;
  readonly setAlwaysOnTop: (flag: boolean, level: 'screen-saver') => void;
  readonly on: (event: 'closed', listener: () => void) => void;
}

export interface NotificationControllerPorts<Window extends NotificationWindow> {
  readonly isShutdown: () => boolean;
  readonly createWindow: () => Window;
  readonly loadWindow: (window: Window) => Promise<void>;
  readonly logLoadError: (error: Error) => void;
}

export interface NotificationController {
  readonly show: (title: string, body: string, type?: NotificationType) => void;
  readonly shutdown: () => void;
  readonly getWindow: () => any | null;
}

export function createNotificationController<Window extends NotificationWindow>(
  ports: NotificationControllerPorts<Window>
): NotificationController {
  let window: Window | null = null;
  let pending: NotificationPayload | null = null;
  let rendererReady = false;
  let generation = 0;
  let dismissTimer: NodeJS.Timeout | null = null;
  let closeTimer: NodeJS.Timeout | null = null;

  const clearTimers = (): void => {
    if (dismissTimer) clearTimeout(dismissTimer);
    if (closeTimer) clearTimeout(closeTimer);
    dismissTimer = null;
    closeTimer = null;
  };

  const display = (
    target: Window,
    currentGeneration: number,
    payload: NotificationPayload
  ): void => {
    target.webContents.send('notification-data', payload);
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (window !== target || generation !== currentGeneration || ports.isShutdown()) return;
      target.webContents.send('notification-dismiss');
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (window === target && generation === currentGeneration && !ports.isShutdown()) {
          target.hide();
        }
      }, 500);
    }, 3500);
  };

  const createWindow = (payload: NotificationPayload): void => {
    pending = payload;
    const target = ports.createWindow();
    window = target;
    rendererReady = false;
    target.setAlwaysOnTop(true, 'screen-saver');
    const currentGeneration = ++generation;

    target.webContents.once('did-finish-load', () => {
      rendererReady = true;
      if (
        window !== target ||
        generation !== currentGeneration ||
        pending === null ||
        ports.isShutdown()
      ) {
        return;
      }
      const nextPayload = pending;
      pending = null;
      target.show();
      display(target, currentGeneration, nextPayload);
    });

    void ports.loadWindow(target).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      ports.logLoadError(error);
    });

    target.on('closed', () => {
      if (window !== target) return;
      window = null;
      rendererReady = false;
    });
  };

  const show = (title: string, body: string, type: NotificationType = 'info'): void => {
    if (ports.isShutdown()) return;
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
    } else {
      pending = payload;
    }
  };

  const shutdown = (): void => {
    generation += 1;
    pending = null;
    clearTimers();
  };

  return { show, shutdown, getWindow: () => window };
}

export function createElectronNotificationController(
  isShutdown: () => boolean
): NotificationController {
  return createNotificationController<BrowserWindow>({
    isShutdown,
    createWindow: () => {
      const workArea = screen.getPrimaryDisplay().workArea;
      const width = 360;
      const height = 90;
      return new BrowserWindow({
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
          preload: path.join(__dirname, '..', 'preload-notification.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
    },
    loadWindow: (window) =>
      window
        .loadFile(path.join(app.getAppPath(), 'src', 'notification.html'))
        .then(() => undefined),
    logLoadError: (error) => console.error('Failed to load notification file:', error),
  });
}
