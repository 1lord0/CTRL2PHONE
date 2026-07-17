"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePillVisibility = normalizePillVisibility;
exports.shouldShowCompactPill = shouldShowCompactPill;
function normalizePillVisibility(value) {
    return value === 'background' || value === 'capture-only' ? value : 'always';
}
function shouldShowCompactPill(visibility, state) {
    if (visibility === 'capture-only')
        return state.selectionActive;
    if (state.transientActive)
        return true;
    if (visibility === 'always')
        return true;
    return state.selectionActive;
}
