"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineSelectionDragPassthrough = determineSelectionDragPassthrough;
function determineSelectionDragPassthrough(params) {
    const { overlayActive, sessionIdCurrent, selectionRect, dragProxyReady, annotationToolActive, pointerX, pointerY, interactiveElementHovered, previousPassthrough, } = params;
    if (!overlayActive ||
        !sessionIdCurrent ||
        !selectionRect ||
        !dragProxyReady ||
        annotationToolActive ||
        interactiveElementHovered) {
        return previousPassthrough ? 'passthrough_off' : 'no_change';
    }
    const inside = pointerX >= selectionRect.x &&
        pointerX <= selectionRect.x + selectionRect.width &&
        pointerY >= selectionRect.y &&
        pointerY <= selectionRect.y + selectionRect.height;
    if (inside) {
        return previousPassthrough ? 'no_change' : 'passthrough_on';
    }
    else {
        return previousPassthrough ? 'passthrough_off' : 'no_change';
    }
}
