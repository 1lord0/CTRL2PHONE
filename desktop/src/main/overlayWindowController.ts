import {
  activateSelectionOverlay,
  OverlayWindowPort as ActivationWindowPort,
} from '../lib/overlayActivation';
import * as path from 'path';

export interface OverlayWindowPort {
  isDestroyed(): boolean;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void;
  showInactive(): void;
  hide(): void;
  webContents: {
    send(channel: string, ...args: any[]): void;
    isDestroyed(): boolean;
    loadFile(filePath: string): Promise<void>;
    once(event: string, callback: () => void): void;
  };
  on(event: string, callback: () => void): void;
}

export interface OverlayWindowControllerPorts<WindowType> {
  createWindow(bounds: { x: number; y: number; width: number; height: number }): WindowType;
  getVirtualBounds(): { x: number; y: number; width: number; height: number };
  getAppPath(): string;
  getPreloadPath(): string;
  isSelectionSessionCurrent(sessionId: number): boolean;
  isSelectionSessionActive(): boolean;
  getSelectionSessionRect(): { x: number; y: number; width: number; height: number } | null;
  restorePillHudLayer(): void;
  applyCompactPillVisibility(): void;
  log(message: string): void;
  warn(message: string, error?: any): void;
  error(message: string, error?: any): void;
}

export interface OverlayWindowController<WindowType extends OverlayWindowPort> {
  ensureWindow(): WindowType;
  getWindow(): WindowType | null;
  getGeneration(): number;
  show(
    backgroundImagePath: string,
    bounds: { x: number; y: number; width: number; height: number },
    sessionId: number
  ): Promise<void>;
  hide(sessionId: number): void;
  sendInstruction(message: string, sessionId: number): void;
  handleRendererReady(): void;
  handleRendered(sessionId: number): void;
  invalidateLifecycle(): void;
  destroy(): void;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createOverlayWindowController<WindowType extends OverlayWindowPort>(
  ports: OverlayWindowControllerPorts<WindowType>
): OverlayWindowController<WindowType> {
  let overlayWindow: WindowType | null = null;
  let overlayGeneration = 0;
  let overlayLifecycle: {
    window: WindowType;
    generation: number;
    loadPromise: Promise<void>;
    rendererReadyPromise: Promise<void>;
    resolveRendererReady: () => void;
    rendererReady: boolean;
  } | null = null;

  let pendingRenderWaiter: {
    sessionId: number;
    generation: number;
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  function clearPendingRenderWaiter(): void {
    if (pendingRenderWaiter) {
      pendingRenderWaiter.reject(new Error('Render waiter cleared/cancelled'));
      pendingRenderWaiter = null;
    }
  }

  function isWindowUsable(win: WindowType | null | undefined): win is WindowType {
    return Boolean(win && !win.isDestroyed() && !win.webContents.isDestroyed());
  }

  function sendOverlayState(state: any): void {
    if (isWindowUsable(overlayWindow)) {
      overlayWindow.webContents.send('overlay-state', state);
    }
  }

  async function waitForOverlayReady(
    lifecycle: NonNullable<typeof overlayLifecycle>
  ): Promise<void> {
    await lifecycle.loadPromise;
    if (lifecycle.generation !== overlayGeneration || !isWindowUsable(lifecycle.window)) {
      throw new Error('Overlay generation changed during load');
    }
    await withTimeout(
      lifecycle.rendererReadyPromise,
      2500,
      'Overlay renderer initialization handshake timed out'
    );
    if (lifecycle.generation !== overlayGeneration || !isWindowUsable(lifecycle.window)) {
      throw new Error('Overlay generation changed during handshake');
    }
  }

  const self: OverlayWindowController<WindowType> = {
    ensureWindow() {
      if (overlayWindow && !overlayWindow.isDestroyed() && overlayLifecycle) {
        return overlayWindow;
      }

      self.invalidateLifecycle();
      const generation = overlayGeneration;
      const bounds = ports.getVirtualBounds();

      overlayWindow = ports.createWindow(bounds);
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });

      let resolveLoad!: () => void;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      let resolveReady!: () => void;
      const rendererReadyPromise = new Promise<void>((resolve) => {
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

      overlayWindow.webContents
        .loadFile(path.join(ports.getAppPath(), 'src', 'overlay.html'))
        .catch((err) => {
          ports.error('Failed to load overlay html:', err);
        });

      return overlayWindow;
    },

    getWindow() {
      return overlayWindow;
    },

    getGeneration() {
      return overlayGeneration;
    },

    async show(backgroundImagePath, bounds, sessionId) {
      const win = self.ensureWindow();
      if (!isWindowUsable(win)) return;

      const currentGeneration = overlayGeneration;
      const lifecycle = overlayLifecycle;

      const windowPort: ActivationWindowPort = {
        setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => {
          if (isWindowUsable(win)) {
            win.setIgnoreMouseEvents(ignore, options);
          }
        },
        setBounds: (b: { x: number; y: number; width: number; height: number }) => {
          if (isWindowUsable(win)) {
            win.setBounds(b);
          }
        },
        sendOverlayState: (state: any) => {
          sendOverlayState(state);
        },
        showInactive: () => {
          if (isWindowUsable(win)) {
            win.showInactive();
          }
        },
      };

      const isCurrent = () => {
        return (
          isWindowUsable(win) &&
          overlayLifecycle === lifecycle &&
          overlayGeneration === currentGeneration &&
          ports.isSelectionSessionActive() &&
          ports.isSelectionSessionCurrent(sessionId)
        );
      };

      const waitForReady = async () => {
        if (lifecycle && lifecycle.window === win) {
          await waitForOverlayReady(lifecycle);
        }
      };

      let activeRenderPromise: Promise<void> | null = null;

      const prepareRenderWaiter = (sessId: number) => {
        if (pendingRenderWaiter) {
          pendingRenderWaiter.reject(new Error('Superseeded by new render waiter'));
          pendingRenderWaiter = null;
        }
        const renderPromise = new Promise<void>((resolve, reject) => {
          pendingRenderWaiter = {
            sessionId: sessId,
            generation: currentGeneration,
            resolve,
            reject,
          };
        });
        activeRenderPromise = withTimeout(
          renderPromise,
          2500,
          'Overlay session render acknowledgement timed out'
        );
      };

      const waitForRendered = async () => {
        if (activeRenderPromise) {
          await activeRenderPromise;
        } else {
          throw new Error('Render waiter was not prepared');
        }
      };

      await activateSelectionOverlay({
        windowPort,
        bounds,
        selectionRect: ports.getSelectionSessionRect(),
        backgroundImagePath,
        sessionId,
        waitForReady,
        prepareRenderWaiter,
        waitForRendered,
        isCurrent,
      });
    },

    hide(sessionId) {
      clearPendingRenderWaiter();
      if (isWindowUsable(overlayWindow)) {
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
        sendOverlayState({
          visible: false,
          active: false,
          selection: null,
          backgroundImage: null,
          sessionId,
        });
        overlayWindow.hide();
      }
      ports.restorePillHudLayer();
      ports.applyCompactPillVisibility();
    },

    sendInstruction(message, sessionId) {
      if (isWindowUsable(overlayWindow) && ports.isSelectionSessionCurrent(sessionId)) {
        overlayWindow.webContents.send('overlay-message', message);
      }
    },

    handleRendererReady() {
      if (overlayLifecycle) {
        overlayLifecycle.rendererReady = true;
        overlayLifecycle.resolveRendererReady();
      }
    },

    handleRendered(sessionId) {
      if (
        pendingRenderWaiter &&
        pendingRenderWaiter.sessionId === sessionId &&
        pendingRenderWaiter.generation === overlayGeneration
      ) {
        pendingRenderWaiter.resolve();
        pendingRenderWaiter = null;
      }
    },

    invalidateLifecycle() {
      clearPendingRenderWaiter();
      overlayGeneration += 1;
      if (overlayLifecycle) {
        overlayLifecycle.resolveRendererReady();
        overlayLifecycle = null;
      }
    },

    destroy() {
      self.invalidateLifecycle();
      overlayWindow = null;
    },
  };

  return self;
}
