"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCopySelection = executeCopySelection;
async function executeCopySelection(ports) {
    if (!ports.isSenderAuthorized()) {
        return { ok: false, error: 'Unauthorized sender' };
    }
    if (!ports.isSessionCurrent()) {
        return { ok: false, error: 'Stale session' };
    }
    try {
        const image = await ports.getSelectionImage();
        if (!image || image.isEmpty()) {
            return { ok: false, error: 'Empty selection image' };
        }
        ports.writeImageToClipboard(image);
        // Verify write by reading it back
        const readImage = ports.readImageFromClipboard();
        if (!readImage || readImage.isEmpty()) {
            return { ok: false, error: 'Clipboard write verification failed' };
        }
        ports.setStatus('Seçim panoya kopyalandı');
        ports.onSuccess?.();
        return { ok: true };
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: errMsg };
    }
}
