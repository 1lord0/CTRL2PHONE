export interface ClipboardSyncContext {
  readonly generation: number;
}

export interface MobileClipboardRow {
  readonly id: string;
  readonly content: string;
}

export interface ClipboardSyncPorts<Context extends ClipboardSyncContext> {
  readonly readClipboard: () => string;
  readonly writeClipboard: (value: string) => void;
  readonly isClipboardGuarded: () => boolean;
  readonly getContext: () => Context | null;
  readonly isContextCurrent: (context: Context) => boolean;
  readonly insertDesktopText: (context: Context, text: string) => Promise<string | null>;
  readonly fetchOldestMobileText: (
    context: Context
  ) => Promise<{ readonly row: MobileClipboardRow | null; readonly error: string | null }>;
  readonly deleteMobileText: (context: Context, id: string) => Promise<string | null>;
  readonly setStatus: (value: string) => void;
  readonly setResponse: (value: string) => void;
  readonly showNotification: (title: string, body: string) => void;
  readonly log: (message: string) => void;
  readonly warn: (message: string, detail?: string) => void;
  readonly error: (message: string, error: Error) => void;
}

export interface ClipboardSyncController {
  readonly sendToPhone: () => Promise<{ ok: boolean; error?: string }>;
  readonly checkFromMobile: () => Promise<void>;
  readonly setupPolling: () => void;
  readonly stopPolling: () => void;
}

export function parseMobileClipboardRow(value: unknown): MobileClipboardRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('id' in value) || !('content' in value)) return null;
  if (typeof value.id !== 'string' || typeof value.content !== 'string') return null;
  return { id: value.id, content: value.content };
}

export function createClipboardSyncController<Context extends ClipboardSyncContext>(
  ports: ClipboardSyncPorts<Context>
): ClipboardSyncController {
  let pollingInterval: NodeJS.Timeout | null = null;
  let inFlightGeneration: number | null = null;
  let lastProcessedId: string | null = null;

  const sendToPhone = async (): Promise<{ ok: boolean; error?: string }> => {
    const clipboardText = ports.readClipboard();
    const text = clipboardText.trim();
    if (!text) {
      ports.setStatus('Panoda kopyalanmış metin bulunamadı');
      return { ok: false, error: 'Panoda metin yok' };
    }
    const context = ports.getContext();
    if (!context) {
      ports.setStatus('Supabase ayarları eksik!');
      return { ok: false, error: 'Supabase ayarları eksik' };
    }

    try {
      const insertError = await ports.insertDesktopText(context, text);
      if (insertError) throw new Error(insertError);
      if (!ports.isContextCurrent(context)) {
        return { ok: false, error: 'Supabase ayarları gönderim sırasında değişti' };
      }

      ports.showNotification('Metin Telefona Gönderildi', preview(text));
      ports.setStatus('Pano metni telefona gönderildi');
      ports.setResponse(`Gönderilen metin: ${text.substring(0, 200)}`);
      return { ok: true };
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.error('Clipboard send error:', error);
      ports.setStatus(`Metin gönderme hatası: ${error.message}`);
      return { ok: false, error: error.message };
    }
  };

  const checkFromMobile = async (): Promise<void> => {
    if (ports.isClipboardGuarded()) return;
    const context = ports.getContext();
    if (!context || inFlightGeneration === context.generation) return;
    inFlightGeneration = context.generation;
    try {
      const result = await ports.fetchOldestMobileText(context);
      if (result.error) {
        ports.warn('Clipboard poll error:', result.error);
        return;
      }
      if (!ports.isContextCurrent(context) || ports.isClipboardGuarded()) return;
      const row = result.row;
      if (!row) return;

      if (row.id !== lastProcessedId) {
        lastProcessedId = row.id;
        if (row.content) {
          ports.writeClipboard(row.content);
          ports.showNotification('Telefondan Metin Alındı', preview(row.content));
          ports.setStatus('Telefondan metin alındı');
          ports.setResponse(`Alınan metin: ${row.content.substring(0, 200)}`);
        }
      }

      const deleteError = await ports.deleteMobileText(context, row.id);
      if (deleteError) ports.warn('Clipboard row cleanup failed:', deleteError);
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      ports.error('checkClipboardFromMobile error:', error);
    } finally {
      if (inFlightGeneration === context.generation) inFlightGeneration = null;
    }
  };

  const stopPolling = (): void => {
    if (!pollingInterval) return;
    clearInterval(pollingInterval);
    pollingInterval = null;
  };

  const setupPolling = (): void => {
    stopPolling();
    if (!ports.getContext()) {
      ports.log('Clipboard polling: waiting for Supabase settings');
      return;
    }
    pollingInterval = setInterval(() => void checkFromMobile(), 1500);
    ports.log('Clipboard polling initialized (1.5s)');
  };

  return { sendToPhone, checkFromMobile, setupPolling, stopPolling };
}

function preview(text: string): string {
  return text.length > 60 ? `${text.substring(0, 60)}...` : text;
}
