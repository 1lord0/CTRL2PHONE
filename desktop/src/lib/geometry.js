"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVirtualBounds = getVirtualBounds;
exports.toAbsoluteRect = toAbsoluteRect;
exports.clampRectToDisplay = clampRectToDisplay;
exports.computeCropRect = computeCropRect;
/** Smallest rect covering all display bounds (the virtual desktop). */
function getVirtualBounds(displays) {
    if (displays.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    const first = displays[0].bounds;
    const acc = displays.reduce((a, d) => ({
        x: Math.min(a.x, d.bounds.x),
        y: Math.min(a.y, d.bounds.y),
        right: Math.max(a.right, d.bounds.x + d.bounds.width),
        bottom: Math.max(a.bottom, d.bounds.y + d.bounds.height),
    }), {
        x: first.x,
        y: first.y,
        right: first.x + first.width,
        bottom: first.y + first.height,
    });
    return { x: acc.x, y: acc.y, width: acc.right - acc.x, height: acc.bottom - acc.y };
}
/** Translate an overlay-relative rect into virtual-desktop absolute coordinates. */
function toAbsoluteRect(rect, virtualBounds) {
    return {
        x: rect.x + virtualBounds.x,
        y: rect.y + virtualBounds.y,
        width: rect.width,
        height: rect.height,
    };
}
/** Clamp a rect to a single display's bounds (zero size if there is no overlap). */
function clampRectToDisplay(rect, displayBounds) {
    const x = Math.max(rect.x, displayBounds.x);
    const y = Math.max(rect.y, displayBounds.y);
    const right = Math.min(rect.x + rect.width, displayBounds.x + displayBounds.width);
    const bottom = Math.min(rect.y + rect.height, displayBounds.y + displayBounds.height);
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}
/**
 * Convert a DIP rect (already clamped to one display) into the pixel crop rect
 * inside that display's captured image. The scale is derived from the captured
 * image's real size (so fractional DPI like 150% is handled correctly), falling
 * back to the reported scaleFactor when the image size is unusable.
 */
function computeCropRect(rect, displayBounds, imageSize, scaleFactor) {
    const fallback = scaleFactor || 1;
    let scaleX = displayBounds.width > 0 ? imageSize.width / displayBounds.width : fallback;
    let scaleY = displayBounds.height > 0 ? imageSize.height / displayBounds.height : fallback;
    if (!isFinite(scaleX) || scaleX <= 0)
        scaleX = fallback;
    if (!isFinite(scaleY) || scaleY <= 0)
        scaleY = fallback;
    return {
        x: Math.round((rect.x - displayBounds.x) * scaleX),
        y: Math.round((rect.y - displayBounds.y) * scaleY),
        width: Math.round(rect.width * scaleX),
        height: Math.round(rect.height * scaleY),
    };
}
