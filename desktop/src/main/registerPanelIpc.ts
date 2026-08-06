import { IpcMain } from 'electron';
import type { DiagnosticsLogger } from './diagnosticsLogger';

export interface PanelIpcDeps {
  isShutdownStarted(): boolean;
  isMainSender(sender: any): boolean;
  mainWindowController: {
    syncCompactPillLayer(): void;
    getWindow(): any;
    getPanelMode(): string;
    toggleSpotlight(): void;
    clampPillBounds(bounds: any): any;
    getCompactPillSize(): { width: number; height: number };
    dismissSpotlight(flag?: boolean): void;
    resizeCompactPill(width: number, height: number): void;
    presentSpotlight(): void;
    destroy(): void;
  };
  settings: any;
  settingsStore: {
    save(): void;
  };
  quitApplication(): void;
  diagnostics?: Pick<DiagnosticsLogger, 'action'>;
}

export function registerPanelIpc(ipc: IpcMain, deps: PanelIpcDeps): () => void {
  ipc.handle('panel-interact-start', (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    deps.diagnostics?.action('panel.interaction_started', {
      mode: deps.mainWindowController.getPanelMode(),
    });
    deps.mainWindowController.syncCompactPillLayer();
    const mainWindow = deps.mainWindowController.getWindow();
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      deps.mainWindowController.getPanelMode() === 'compact'
    ) {
      mainWindow.focus();
    }
    return { ok: true };
  });

  ipc.handle('panel-toggle', (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    deps.diagnostics?.action('panel.toggle_requested', {
      fromMode: deps.mainWindowController.getPanelMode(),
    });
    deps.mainWindowController.toggleSpotlight();
    return { ok: true, mode: deps.mainWindowController.getPanelMode() };
  });

  ipc.handle('panel-drag-by', (event: any, dx: number, dy: number) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const mainWindow = deps.mainWindowController.getWindow();
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      deps.mainWindowController.getPanelMode() !== 'compact' ||
      deps.isShutdownStarted()
    ) {
      return { ok: false };
    }
    const deltaX = Math.round(Number(dx));
    const deltaY = Math.round(Number(dy));
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) {
      return { ok: false };
    }
    const bounds = deps.mainWindowController.clampPillBounds({
      x: mainWindow.getBounds().x + deltaX,
      y: mainWindow.getBounds().y + deltaY,
      width: deps.mainWindowController.getCompactPillSize().width,
      height: deps.mainWindowController.getCompactPillSize().height,
    });
    mainWindow.setBounds(bounds); // setPosition or setBounds can be used
    return { ok: true };
  });

  ipc.handle('panel-dismiss', (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    deps.diagnostics?.action('panel.dismiss_requested');
    deps.mainWindowController.dismissSpotlight(true);
    return { ok: true, mode: deps.mainWindowController.getPanelMode() };
  });

  ipc.handle('panel-resize-compact', (event: any, size: { width?: number; height?: number }) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    const width = typeof size?.width === 'number' ? size.width : 320;
    const height = typeof size?.height === 'number' ? size.height : 52;
    deps.mainWindowController.resizeCompactPill(width, height);
    return {
      ok: true,
      width: deps.mainWindowController.getCompactPillSize().width,
      height: deps.mainWindowController.getCompactPillSize().height,
    };
  });

  ipc.handle('panel-save-pinned', (event: any, pinned: boolean) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    deps.diagnostics?.action('panel.pin_changed', { pinned: Boolean(pinned) });
    deps.settings.panelPinned = Boolean(pinned);
    deps.settingsStore.save();
    const mainWindow = deps.mainWindowController.getWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(Boolean(pinned));
    }
    if (pinned) {
      deps.mainWindowController.presentSpotlight();
    }
    return { ok: true };
  });

  ipc.handle('app-quit', (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    const mainWindow = deps.mainWindowController.getWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Give immediate visual feedback while the lifecycle controller drains active work.
      mainWindow.hide();
    }
    deps.diagnostics?.action('app.close_button_confirmed');
    deps.quitApplication();
    return { ok: true };
  });

  return () => {
    ipc.removeHandler('panel-interact-start');
    ipc.removeHandler('panel-toggle');
    ipc.removeHandler('panel-drag-by');
    ipc.removeHandler('panel-dismiss');
    ipc.removeHandler('panel-resize-compact');
    ipc.removeHandler('panel-save-pinned');
    ipc.removeHandler('app-quit');
  };
}
