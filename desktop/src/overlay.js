"use strict";
const selectionBox = document.getElementById('selectionBox');
const overlayText = document.getElementById('overlayText');
const actionBar = document.getElementById('actionBar');
const btnGemini = document.getElementById('btnGemini');
const btnPhone = document.getElementById('btnPhone');
const btnCancel = document.getElementById('btnCancel');
let active = false;
let dragging = false;
let startPoint = null;
let currentRect = null;
function renderSelection(rect) {
    if (!rect) {
        selectionBox.classList.add('hidden');
        actionBar.classList.add('hidden');
        return;
    }
    selectionBox.classList.remove('hidden');
    selectionBox.style.left = `${rect.x}px`;
    selectionBox.style.top = `${rect.y}px`;
    selectionBox.style.width = `${rect.width}px`;
    selectionBox.style.height = `${rect.height}px`;
}
function updateRect(endPoint) {
    if (!startPoint) {
        return null;
    }
    const x = Math.min(startPoint.x, endPoint.x);
    const y = Math.min(startPoint.y, endPoint.y);
    const width = Math.abs(endPoint.x - startPoint.x);
    const height = Math.abs(endPoint.y - startPoint.y);
    return { x, y, width, height };
}
window.addEventListener('mousemove', (event) => {
    if (!active) {
        return;
    }
    if (dragging) {
        currentRect = updateRect({ x: event.clientX, y: event.clientY });
        renderSelection(currentRect);
    }
});
window.addEventListener('mousedown', (event) => {
    if (!active || event.button !== 0) {
        return;
    }
    // Check if click was inside the action bar; if so, do not initiate a new drag
    if (actionBar.contains(event.target)) {
        return;
    }
    dragging = true;
    document.body.classList.add('selecting');
    actionBar.classList.add('hidden');
    startPoint = { x: event.clientX, y: event.clientY };
    currentRect = { x: startPoint.x, y: startPoint.y, width: 0, height: 0 };
    overlayText.textContent = 'Alanı seçin (X / Enter ile Gemini, M ile Telefon)';
    renderSelection(currentRect);
    window.bridge.setSelection({ type: 'start' });
});
window.addEventListener('mouseup', async (event) => {
    if (!active || event.button !== 0 || !dragging) {
        return;
    }
    // Check if click was inside the action bar
    if (actionBar.contains(event.target)) {
        dragging = false;
        return;
    }
    dragging = false;
    currentRect = updateRect({ x: event.clientX, y: event.clientY });
    renderSelection(currentRect);
    if (currentRect && currentRect.width > 4 && currentRect.height > 4) {
        await window.bridge.setSelection({ type: 'update', rect: currentRect });
        overlayText.textContent = 'Seçim hazır. Gönderim modunu seçin:';
        // Position action bar correctly and make it visible
        actionBar.classList.remove('hidden');
    }
    else {
        currentRect = null;
        startPoint = null;
        renderSelection(null);
        document.body.classList.remove('selecting');
        overlayText.textContent = 'Ekranı sürükleyerek bir alan seçin.';
    }
});
window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
});
// ── Button Event Listeners ───────────────────────────────────────
btnGemini.addEventListener('click', (e) => {
    e.stopPropagation();
    window.bridge.confirmSelectionGemini();
});
btnPhone.addEventListener('click', (e) => {
    e.stopPropagation();
    window.bridge.confirmSelectionPhone();
});
btnCancel.addEventListener('click', (e) => {
    e.stopPropagation();
    window.bridge.cancelSelection();
});
// ── Bridge State Updates ─────────────────────────────────────────
window.bridge.onOverlayState((state) => {
    active = Boolean(state?.active);
    selectionBox.classList.toggle('hidden', !state?.visible);
    if (state?.backgroundImage) {
        document.body.style.backgroundImage = `url("${state.backgroundImage}")`;
    }
    else {
        document.body.style.backgroundImage = 'none';
    }
    if (!active) {
        dragging = false;
        startPoint = null;
        document.body.classList.remove('selecting');
        actionBar.classList.add('hidden');
    }
    if (state?.selection) {
        currentRect = state.selection;
        renderSelection(currentRect);
        document.body.classList.add('selecting');
        actionBar.classList.remove('hidden');
    }
    else if (!dragging) {
        currentRect = null;
        renderSelection(null);
        actionBar.classList.add('hidden');
    }
});
window.bridge.onOverlayMessage((message) => {
    overlayText.textContent = message;
});
