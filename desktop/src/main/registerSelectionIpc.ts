import { IpcMain } from 'electron';
import type { DiagnosticsLogger } from './diagnosticsLogger';

export interface SelectionIpcDeps {
  isOverlaySender(sender: any): boolean;
  isMainSender(sender: any): boolean;
  overlayWindowController: {
    getWindow(): any;
    hide(sessionId: number): void;
    handleRendererReady(): void;
    handleRendered(sessionId: number): void;
  };
  selectionSession: {
    active: boolean;
    rect: any;
    display: any;
    sessionId: number;
    dragEnabled: boolean;
    isCurrent(sessionId: number): boolean;
    snapshot(sessionId: number): any;
    setRect(sessionId: number, rect: any): boolean;
    setDisplay(sessionId: number, display: any): boolean;
    setAnnotated(sessionId: number, hasAnnotations: boolean): boolean;
    reset(sessionId: number): boolean;
    disableDrag(sessionId: number): void;
  };
  resolveSelectionImage(snapshot: any): Promise<any>;
  executeCopySelection(ports: any): Promise<any>;
  writeImageToClipboard(image: any): void;
  readImageFromClipboard(): any;
  setStatus(msg: string): void;
  selectionDragAssetStore: {
    invalidate(): void;
    currentPath: string | null;
    detach(): void;
    delete(filePath: string): void;
  };
  getDisplayNearestPoint(pt: any): any;
  getCursorScreenPoint(): any;
  updateSelectionDragAsset(sessionId: number): Promise<void>;
  captureAndSend(sessionId: number): Promise<void>;
  captureAndRunAction(sessionId: number): Promise<boolean>;
  captureAndSendToSupabase(sessionId: number): Promise<boolean>;
  captureAndOcr(sessionId: number): Promise<void>;
  isShutdownStarted(): boolean;
  startSelectionSession(): Promise<void>;
  executeSelectionElectronDrag(config: any): any;
  fileExistsSync(filePath: string): boolean;
  createNativeImageFromPath(filePath: string): any;
  createNativeImageFromBuffer(buffer: Buffer): any;
  calculateDragPreviewSize(size: any, max: any): any;
  sendOverlayState?(state: any): void;
  mainWindowController: {
    hidePillForScreenshot(): void;
  };
  diagnostics?: Pick<DiagnosticsLogger, 'action' | 'error'>;
}

export function registerSelectionIpc(ipc: IpcMain, deps: SelectionIpcDeps): () => void {
  ipc.handle('copy-selection', async (event: any, sessionId: number) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.copy_requested', { sessionId });
    const overlayWindow = deps.overlayWindowController.getWindow();
    const ports = {
      isSenderAuthorized: () => {
        return (
          overlayWindow !== null &&
          !overlayWindow.isDestroyed() &&
          event.sender === overlayWindow.webContents
        );
      },
      isSessionCurrent: () => {
        return deps.selectionSession.isCurrent(sessionId);
      },
      getSelectionImage: async () => {
        const snapshot = deps.selectionSession.snapshot(sessionId);
        if (!snapshot) return null;
        return await deps.resolveSelectionImage(snapshot);
      },
      writeImageToClipboard: (image: any) => {
        deps.writeImageToClipboard(image);
      },
      readImageFromClipboard: () => {
        return deps.readImageFromClipboard();
      },
      setStatus: (msg: string) => {
        deps.setStatus(msg);
      },
      onSuccess: () => {
        deps.selectionDragAssetStore.invalidate();
        deps.overlayWindowController.hide(sessionId);
        deps.selectionSession.reset(sessionId);
      },
    };
    return await deps.executeCopySelection(ports);
  });

  ipc.handle('set-selection', (event: any, payload: any) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.area_confirmed', {
      sessionId: payload?.sessionId,
      width: payload?.width,
      height: payload?.height,
    });
    if (!deps.selectionSession.active || !deps.selectionSession.isCurrent(payload?.sessionId)) {
      return { ok: false };
    }

    if (payload?.type === 'start') {
      deps.selectionDragAssetStore.invalidate();
      deps.selectionSession.setRect(payload.sessionId, null);
      return { ok: true };
    }

    if (payload?.type === 'update') {
      const rect = payload.rect;
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        deps.selectionDragAssetStore.invalidate();
        deps.selectionSession.setRect(payload.sessionId, null);
        deps.selectionSession.setDisplay(payload.sessionId, null);
        return { ok: true };
      }

      deps.selectionDragAssetStore.invalidate();
      deps.selectionSession.setRect(payload.sessionId, rect);
      if (!deps.selectionSession.display) {
        deps.selectionSession.setDisplay(
          payload.sessionId,
          deps.getDisplayNearestPoint(deps.getCursorScreenPoint())
        );
      }
      deps.mainWindowController.hidePillForScreenshot();
      if (deps.selectionSession.dragEnabled) {
        void deps.updateSelectionDragAsset(payload.sessionId);
      }
      return { ok: true };
    }

    return { ok: false };
  });

  ipc.handle('cancel-selection', (event: any, sessionId: number) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.cancel_requested', { sessionId });
    if (!deps.selectionSession.active || !deps.selectionSession.isCurrent(sessionId))
      return { ok: false };
    deps.overlayWindowController.hide(sessionId);
    deps.selectionSession.reset(sessionId);
    deps.setStatus('Seçim iptal edildi');
    return { ok: true };
  });

  ipc.handle('set-annotated', (event: any, payload: any) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.annotation_changed', {
      sessionId: payload?.sessionId,
      hasAnnotations: Boolean(payload?.hasAnnotations),
    });
    if (!deps.selectionSession.active || !deps.selectionSession.isCurrent(payload?.sessionId))
      return { ok: false };
    deps.selectionDragAssetStore.invalidate();
    deps.selectionSession.setAnnotated(payload.sessionId, Boolean(payload.hasAnnotations));
    if (deps.selectionSession.dragEnabled) {
      void deps.updateSelectionDragAsset(payload.sessionId);
    }
    return { ok: true };
  });

  ipc.handle('confirm-selection-gemini', async (event: any, sessionId: number) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.send_to_gemini_requested', { sessionId });
    if (
      deps.selectionSession.active &&
      deps.selectionSession.rect &&
      deps.selectionSession.isCurrent(sessionId)
    ) {
      await deps.captureAndSend(sessionId);
      return { ok: true };
    }
    return { ok: false };
  });

  ipc.handle('confirm-selection-action', async (event: any, sessionId: number) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.action_requested', { sessionId });
    if (
      deps.selectionSession.active &&
      deps.selectionSession.rect &&
      deps.selectionSession.isCurrent(sessionId)
    ) {
      return { ok: await deps.captureAndRunAction(sessionId) };
    }
    return { ok: false };
  });

  ipc.handle('confirm-selection-phone', async (event: any, sessionId: number) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.send_to_phone_requested', { sessionId });
    if (
      deps.selectionSession.active &&
      deps.selectionSession.rect &&
      deps.selectionSession.isCurrent(sessionId)
    ) {
      await deps.captureAndSendToSupabase(sessionId);
      return { ok: true };
    }
    return { ok: false };
  });

  ipc.handle('confirm-selection-ocr', async (event: any, sessionId: number) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.ocr_requested', { sessionId });
    if (
      deps.selectionSession.active &&
      deps.selectionSession.rect &&
      deps.selectionSession.isCurrent(sessionId)
    ) {
      await deps.captureAndOcr(sessionId);
      return { ok: true };
    }
    return { ok: false };
  });

  ipc.handle('capture-now', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    deps.diagnostics?.action('selection.capture_requested');
    if (deps.isShutdownStarted()) return { ok: false };
    if (!deps.selectionSession.active) {
      void deps.startSelectionSession();
      return { ok: true, mode: 'selection-opened' };
    }
    void deps.captureAndSend(deps.selectionSession.sessionId);
    return { ok: true };
  });

  ipc.handle('overlay-renderer-ready', (event: any) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const overlayWindow = deps.overlayWindowController.getWindow();
    if (overlayWindow && event.sender === overlayWindow.webContents) {
      deps.overlayWindowController.handleRendererReady();
    }
    return { ok: true };
  });

  ipc.handle('overlay-rendered', (event: any, sessionId: number) => {
    if (!deps.isOverlaySender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const overlayWindow = deps.overlayWindowController.getWindow();
    if (!overlayWindow || event.sender !== overlayWindow.webContents) return { ok: false };
    if (!deps.selectionSession.isCurrent(sessionId)) return { ok: false };

    deps.overlayWindowController.handleRendered(sessionId);
    return { ok: true };
  });

  const onDrag = (event: any, sessionId: number) => {
    if (!deps.isOverlaySender(event.sender)) return;
    const win = deps.overlayWindowController.getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (!deps.selectionSession.isCurrent(sessionId)) return;

    const result = deps.executeSelectionElectronDrag({
      getAsset: () => {
        const filePath = deps.selectionDragAssetStore.currentPath;
        if (!filePath || !deps.fileExistsSync(filePath)) return null;
        const sourceIcon = deps.createNativeImageFromPath(filePath);
        if (sourceIcon.isEmpty()) return null;
        const previewSize = deps.calculateDragPreviewSize(sourceIcon.getSize(), {
          width: 160,
          height: 120,
        });
        const icon = sourceIcon.resize({ ...previewSize, quality: 'good' });
        return { file: filePath, icon };
      },
      getOverlayBounds: () => win.getBounds(),
      prepareOverlay: () => {
        deps.selectionDragAssetStore.detach();
        deps.selectionSession.disableDrag(sessionId);
        win.setIgnoreMouseEvents(true, { forward: true });

        if (deps.sendOverlayState) {
          deps.sendOverlayState({
            visible: false,
            active: false,
            selection: null,
            backgroundImage: null,
            sessionId,
          });
        }
        win.setAlwaysOnTop(false);
        win.setBounds({ x: -32000, y: -32000, width: 1, height: 1 });
        win.blur();
      },
      startDrag: (asset: any) => {
        event.sender.startDrag(asset);
      },
      restoreOverlayBounds: (bounds: any) => {
        if (!win.isDestroyed()) {
          win.setBounds(bounds);
          win.setAlwaysOnTop(true, 'screen-saver');
        }
      },
      finishSelection: (filePath: string) => {
        deps.overlayWindowController.hide(sessionId);
        deps.selectionSession.reset(sessionId);
        deps.setStatus('Sürükle-bırak tamamlandı');
        const fileTimer = setTimeout(() => {
          deps.selectionDragAssetStore.delete(filePath);
        }, 5 * 60_000);
        if (fileTimer.unref) fileTimer.unref();
      },
      reportError: (message: string) => {
        console.error('Selection startDrag failed:', message);
        deps.setStatus(`Sürükle-bırak başlatılamadı: ${message}`);
      },
    });

    if (!result.ok) {
      console.warn('Selection drag was not started:', result.error);
    }
  };

  ipc.on('start-selection-drag', onDrag);

  return () => {
    ipc.removeHandler('copy-selection');
    ipc.removeHandler('set-selection');
    ipc.removeHandler('cancel-selection');
    ipc.removeHandler('set-annotated');
    ipc.removeHandler('confirm-selection-gemini');
    ipc.removeHandler('confirm-selection-action');
    ipc.removeHandler('confirm-selection-phone');
    ipc.removeHandler('confirm-selection-ocr');
    ipc.removeHandler('capture-now');
    ipc.removeHandler('overlay-renderer-ready');
    ipc.removeHandler('overlay-rendered');
    ipc.removeListener('start-selection-drag', onDrag);
  };
}
