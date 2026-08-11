export interface GlobalKeyRouterPorts {
  // state query
  isSelectionActive(): boolean;
  hasSelectionRect(): boolean;
  isActionBusy(): boolean;
  isShutdownStarted(): boolean;

  // callbacks
  setStatus(message: string): void;
  log(message: string): void;
  error(message: string): void;
  action?(name: string, details?: Readonly<Record<string, unknown>>): void;

  // commands
  startSelectionSession(): void;
  captureAndSend(): void;
  captureAndRunAction?(): void;
  captureAndSendToSupabase(): void;
  captureAndOcr(): void;
  sendClipboardToPhone(): void;
  toggleSpotlight(): void;
  dismissSpotlight(): void;
  cancelSelection(): void;
  quitApplication(): void;
}

export interface GlobalKeyRouter {
  route(event: string): void;
}

export function createGlobalKeyRouter(ports: GlobalKeyRouterPorts): GlobalKeyRouter {
  return {
    route(event: string) {
      if (ports.isShutdownStarted()) return;
      ports.action?.('keyboard.event', { event });

      if (event === 'READY') {
        ports.log('[main.ts] Keyboard hook registered successfully by key_listener.exe');
        ports.setStatus('Çift Ctrl ile seçim modu hazır');
        return;
      }
      if (event === 'HOOK_FAILED' || event.startsWith('HOOK_FAILED:')) {
        ports.error('[main.ts] Keyboard hook registration failed in key_listener.exe: ' + event);
        ports.setStatus('Klavye kancası takılamadı (Sistem engellemiş olabilir)');
        return;
      }
      if (event === 'HOOK_RESTORED') {
        ports.log('[main.ts] Keyboard hook restored by key_listener.exe');
        ports.setStatus('Çift Ctrl ile seçim modu hazır');
        return;
      }

      if (event === 'DOUBLE_CTRL') {
        if (!ports.isSelectionActive()) {
          ports.startSelectionSession();
        }
      } else if (event === 'KEY_A') {
        if (ports.isSelectionActive()) {
          if (!ports.hasSelectionRect()) {
            ports.setStatus('Önce fareyle bir alan seç.');
            return;
          }
          ports.captureAndRunAction?.();
        }
      } else if (event === 'KEY_X' || event === 'KEY_RETURN') {
        if (ports.isSelectionActive()) {
          if (!ports.hasSelectionRect()) {
            ports.setStatus('Önce fareyle bir alan seç.');
            return;
          }
          ports.captureAndSend();
        }
      } else if (event === 'KEY_M') {
        if (ports.isSelectionActive()) {
          if (!ports.hasSelectionRect()) {
            ports.setStatus('Önce fareyle bir alan seç.');
            return;
          }
          ports.captureAndSendToSupabase();
        }
      } else if (event === 'KEY_C') {
        if (ports.isSelectionActive()) {
          if (!ports.hasSelectionRect()) {
            ports.setStatus('Önce fareyle bir alan seç.');
            return;
          }
          ports.log('KEY_C → OCR başlatılıyor');
          ports.captureAndOcr();
        }
      } else if (event === 'CTRL_SHIFT_V') {
        ports.sendClipboardToPhone();
      } else if (event === 'CTRL_SHIFT_SPACE') {
        ports.toggleSpotlight();
      } else if (event === 'SPOTLIGHT_DISMISS') {
        ports.dismissSpotlight();
      } else if (event === 'KEY_ESCAPE') {
        if (ports.isSelectionActive()) {
          ports.cancelSelection();
          ports.setStatus('Seçim iptal edildi');
        }
      } else if (event === 'KEY_Q') {
        if (ports.isSelectionActive()) {
          ports.cancelSelection();
        }
        ports.quitApplication();
      }
    },
  };
}
