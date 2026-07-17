"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDragPreviewSize = calculateDragPreviewSize;
exports.executeSelectionElectronDrag = executeSelectionElectronDrag;
function calculateDragPreviewSize(source, maximum) {
    const scale = Math.min(1, maximum.width / source.width, maximum.height / source.height);
    return {
        width: Math.max(1, Math.round(source.width * scale)),
        height: Math.max(1, Math.round(source.height * scale)),
    };
}
function executeSelectionElectronDrag(ports) {
    const asset = ports.getAsset();
    if (!asset) {
        return { ok: false, error: 'drag asset is not ready' };
    }
    const bounds = ports.getOverlayBounds();
    ports.prepareOverlay();
    try {
        ports.startDrag(asset);
        return { ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ports.reportError(message);
        return { ok: false, error: message };
    }
    finally {
        ports.restoreOverlayBounds(bounds);
        ports.finishSelection(asset.file);
    }
}
