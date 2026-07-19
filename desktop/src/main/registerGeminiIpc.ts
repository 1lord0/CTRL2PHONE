import { IpcMain } from 'electron';

export interface GeminiIpcDeps {
  isShutdownStarted(): boolean;
  isMainSender(sender: any): boolean;
  sendClipboardToPhone(): Promise<any>;
  geminiWindowController: {
    open(): Promise<any>;
  };
}

export function registerGeminiIpc(ipc: IpcMain, deps: GeminiIpcDeps): () => void {
  ipc.handle('send-clipboard', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    return deps.sendClipboardToPhone();
  });

  ipc.handle('open-gemini', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    const windowInstance = await deps.geminiWindowController.open();
    return { ok: Boolean(windowInstance) };
  });

  ipc.handle('focus-gemini', async (event: any) => {
    if (!deps.isMainSender(event.sender)) return { ok: false, error: 'Unauthorized' };
    if (deps.isShutdownStarted()) return { ok: false };
    const windowInstance = await deps.geminiWindowController.open();
    return { ok: Boolean(windowInstance) };
  });

  return () => {
    ipc.removeHandler('send-clipboard');
    ipc.removeHandler('open-gemini');
    ipc.removeHandler('focus-gemini');
  };
}
