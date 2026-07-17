"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMobileClipboardRow = parseMobileClipboardRow;
exports.createClipboardSyncController = createClipboardSyncController;
function parseMobileClipboardRow(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    if (!('id' in value) || !('content' in value))
        return null;
    if (typeof value.id !== 'string' || typeof value.content !== 'string')
        return null;
    return { id: value.id, content: value.content };
}
function createClipboardSyncController(ports) {
    let pollingInterval = null;
    let inFlightGeneration = null;
    let lastProcessedId = null;
    const sendToPhone = async () => {
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
            if (insertError)
                throw new Error(insertError);
            if (!ports.isContextCurrent(context)) {
                return { ok: false, error: 'Supabase ayarları gönderim sırasında değişti' };
            }
            ports.showNotification('Metin Telefona Gönderildi', preview(text));
            ports.setStatus('Pano metni telefona gönderildi');
            ports.setResponse(`Gönderilen metin: ${text.substring(0, 200)}`);
            return { ok: true };
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            ports.error('Clipboard send error:', error);
            ports.setStatus(`Metin gönderme hatası: ${error.message}`);
            return { ok: false, error: error.message };
        }
    };
    const checkFromMobile = async () => {
        if (ports.isClipboardGuarded())
            return;
        const context = ports.getContext();
        if (!context || inFlightGeneration === context.generation)
            return;
        inFlightGeneration = context.generation;
        try {
            const result = await ports.fetchOldestMobileText(context);
            if (result.error) {
                ports.warn('Clipboard poll error:', result.error);
                return;
            }
            if (!ports.isContextCurrent(context) || ports.isClipboardGuarded())
                return;
            const row = result.row;
            if (!row)
                return;
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
            if (deleteError)
                ports.warn('Clipboard row cleanup failed:', deleteError);
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            ports.error('checkClipboardFromMobile error:', error);
        }
        finally {
            if (inFlightGeneration === context.generation)
                inFlightGeneration = null;
        }
    };
    const stopPolling = () => {
        if (!pollingInterval)
            return;
        clearInterval(pollingInterval);
        pollingInterval = null;
    };
    const setupPolling = () => {
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
function preview(text) {
    return text.length > 60 ? `${text.substring(0, 60)}...` : text;
}
