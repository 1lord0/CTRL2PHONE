import { registerPanelIpc } from '../src/main/registerPanelIpc';

class TestIpcMain {
  handlers: Record<string, (...args: any[]) => any> = {};

  handle(channel: string, handler: (...args: any[]) => any): void {
    this.handlers[channel] = handler;
  }

  removeHandler(channel: string): void {
    delete this.handlers[channel];
  }
}

function createDeps() {
  const mainWindow = {
    isDestroyed: jest.fn().mockReturnValue(false),
    hide: jest.fn(),
    setAlwaysOnTop: jest.fn(),
  };
  const deps: any = {
    isMainSender: jest.fn().mockReturnValue(true),
    isShutdownStarted: jest.fn().mockReturnValue(false),
    mainWindowController: {
      getWindow: jest.fn().mockReturnValue(mainWindow),
      getPanelMode: jest.fn().mockReturnValue('presented'),
      syncCompactPillLayer: jest.fn(),
      toggleSpotlight: jest.fn(),
      dismissSpotlight: jest.fn(),
      presentSpotlight: jest.fn(),
      clampPillBounds: jest.fn(),
      getCompactPillSize: jest.fn(),
      resizeCompactPill: jest.fn(),
    },
    settings: { panelPinned: false },
    settingsStore: { save: jest.fn() },
    quitApplication: jest.fn(),
  };
  return { deps, mainWindow };
}

describe('registerPanelIpc', () => {
  it('hides the window immediately before starting graceful shutdown', () => {
    const ipc = new TestIpcMain();
    const { deps, mainWindow } = createDeps();
    registerPanelIpc(ipc as any, deps);

    const result = ipc.handlers['app-quit']({ sender: {} });

    expect(result).toEqual({ ok: true });
    expect(mainWindow.hide).toHaveBeenCalledTimes(1);
    expect(deps.quitApplication).toHaveBeenCalledTimes(1);
    expect(mainWindow.hide.mock.invocationCallOrder[0]).toBeLessThan(
      deps.quitApplication.mock.invocationCallOrder[0]
    );
  });

  it('uses pinning only for always-on-top and does not dismiss the panel when unpinned', () => {
    const ipc = new TestIpcMain();
    const { deps, mainWindow } = createDeps();
    registerPanelIpc(ipc as any, deps);

    const result = ipc.handlers['panel-save-pinned']({ sender: {} }, false);

    expect(result).toEqual({ ok: true });
    expect(mainWindow.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(deps.mainWindowController.dismissSpotlight).not.toHaveBeenCalled();
  });
});
