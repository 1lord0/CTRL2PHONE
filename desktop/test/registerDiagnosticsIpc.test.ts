import { registerDiagnosticsIpc } from '../src/main/registerDiagnosticsIpc';

describe('diagnostics IPC registrar', () => {
  it('records only authorized, valid user actions and disposes its listener', () => {
    let listener: Function | null = null;
    const ipc = {
      on: jest.fn((_channel: string, callback: Function) => {
        listener = callback;
      }),
      removeListener: jest.fn(),
    };
    const diagnostics = { action: jest.fn(), warn: jest.fn() };
    const sender = { id: 'main' };
    const dispose = registerDiagnosticsIpc(ipc as any, {
      isMainSender: (candidate) => candidate === sender,
      diagnostics,
    });

    expect(listener).not.toBeNull();
    (listener as unknown as Function)({ sender }, 'ui.click', { controlId: 'saveSettings' });
    (listener as unknown as Function)({ sender: { id: 'other' } }, 'ui.click', {});
    (listener as unknown as Function)({ sender }, '', {});

    expect(diagnostics.action).toHaveBeenCalledWith('ui.click', { controlId: 'saveSettings' });
    expect(diagnostics.action).toHaveBeenCalledTimes(1);
    expect(diagnostics.warn).toHaveBeenCalledTimes(2);

    dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith('diagnostics-user-action', listener);
  });
});
