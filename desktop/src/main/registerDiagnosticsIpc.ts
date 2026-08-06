import type { IpcMain, IpcMainEvent } from 'electron';
import type { DiagnosticDetails, DiagnosticsLogger } from './diagnosticsLogger';

export interface DiagnosticsIpcDeps {
  isMainSender(sender: any): boolean;
  diagnostics: Pick<DiagnosticsLogger, 'action' | 'warn'>;
}

export function registerDiagnosticsIpc(ipc: IpcMain, deps: DiagnosticsIpcDeps): () => void {
  const onUserAction = (event: IpcMainEvent, rawName: unknown, rawDetails: unknown): void => {
    if (!deps.isMainSender(event.sender)) {
      deps.diagnostics.warn('ipc', 'unauthorized_diagnostics_event');
      return;
    }
    if (typeof rawName !== 'string' || rawName.length === 0 || rawName.length > 120) {
      deps.diagnostics.warn('ipc', 'invalid_diagnostics_action_name');
      return;
    }
    const details: DiagnosticDetails | undefined =
      rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)
        ? (rawDetails as DiagnosticDetails)
        : undefined;
    deps.diagnostics.action(rawName, details);
  };

  ipc.on('diagnostics-user-action', onUserAction);
  return () => ipc.removeListener('diagnostics-user-action', onUserAction);
}
