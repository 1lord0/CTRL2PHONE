"use strict";
const selectionBox = document.getElementById('selectionBox');
const overlayText = document.getElementById('overlayText');
const actionBar = document.getElementById('actionBar');
const btnGemini = document.getElementById('btnGemini');
const btnPhone = document.getElementById('btnPhone');
const btnCancel = document.getElementById('btnCancel');
// ── Annotation layer ─────────────────────────────────────────────
const annotationCanvas = document.getElementById('annotationCanvas');
const actx = annotationCanvas.getContext('2d');
const toolbarEl = document.getElementById('annotationToolbar');
const toolButtons = {
    pen: document.getElementById('toolPen'),
    box: document.getElementById('toolBox'),
    redact: document.getElementById('toolRedact'),
};
const btnColor = document.getElementById('toolColor');
const btnUndo = document.getElementById('toolUndo');
const btnClear = document.getElementById('toolClear');
let active = false;
let dragging = false;
let startPoint = null;
let currentRect = null;
let currentTool = null;
let currentColor = '#ff3b30';
const annotations = [];
let drawing = false;
let drawStart = null;
let liveStroke = null;
let annotatedFlag = false;
let bgDataUrl = null;
function boxFrom(a, b) {
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
    };
}
function syncAnnotatedFlag() {
    const has = annotations.length > 0;
    if (has !== annotatedFlag) {
        annotatedFlag = has;
        window.bridge.setAnnotated(has);
    }
}
function drawOne(ctx, a) {
    if (a.type === 'pen') {
        ctx.strokeStyle = a.color;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        a.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
    }
    else if (a.type === 'box') {
        ctx.strokeStyle = a.color;
        ctx.lineWidth = 3;
        ctx.strokeRect(a.rect.x, a.rect.y, a.rect.width, a.rect.height);
    }
    else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(a.rect.x, a.rect.y, a.rect.width, a.rect.height);
    }
}
function redraw(preview) {
    actx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    for (const a of annotations)
        drawOne(actx, a);
    if (preview)
        drawOne(actx, preview);
}
function resizeCanvas() {
    annotationCanvas.width = window.innerWidth;
    annotationCanvas.height = window.innerHeight;
    redraw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
function setTool(tool) {
    currentTool = tool;
    for (const key of Object.keys(toolButtons)) {
        toolButtons[key].classList.toggle('active', key === tool);
    }
    document.body.classList.toggle('annotating', tool !== null);
}
function showToolbarIfReady() {
    toolbarEl.classList.toggle('hidden', !(currentRect && active));
}
// ── Selection rendering (unchanged behavior) ─────────────────────
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
    return boxFrom(startPoint, endPoint);
}
// ── Mouse handling: draw when a tool is active, otherwise select ──
window.addEventListener('mousemove', (event) => {
    if (!active) {
        return;
    }
    const p = { x: event.clientX, y: event.clientY };
    if (currentTool && drawing) {
        if (currentTool === 'pen' && liveStroke) {
            liveStroke.push(p);
            redraw({ type: 'pen', color: currentColor, points: liveStroke });
        }
        else if (drawStart) {
            const r = boxFrom(drawStart, p);
            redraw(currentTool === 'redact'
                ? { type: 'redact', rect: r }
                : { type: 'box', color: currentColor, rect: r });
        }
        return;
    }
    if (dragging) {
        currentRect = updateRect(p);
        renderSelection(currentRect);
    }
});
window.addEventListener('mousedown', (event) => {
    if (!active || event.button !== 0) {
        return;
    }
    // Clicks on the floating controls must not start a drag/draw.
    if (actionBar.contains(event.target) || toolbarEl.contains(event.target)) {
        return;
    }
    if (currentTool) {
        drawing = true;
        drawStart = { x: event.clientX, y: event.clientY };
        liveStroke = currentTool === 'pen' ? [drawStart] : null;
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
    if (!active || event.button !== 0) {
        return;
    }
    // Finishing an annotation stroke/shape.
    if (currentTool && drawing) {
        drawing = false;
        const p = { x: event.clientX, y: event.clientY };
        if (currentTool === 'pen' && liveStroke && liveStroke.length > 1) {
            annotations.push({ type: 'pen', color: currentColor, points: liveStroke });
        }
        else if (currentTool !== 'pen' && drawStart) {
            const r = boxFrom(drawStart, p);
            if (r.width > 2 && r.height > 2) {
                annotations.push(currentTool === 'redact'
                    ? { type: 'redact', rect: r }
                    : { type: 'box', color: currentColor, rect: r });
            }
        }
        liveStroke = null;
        drawStart = null;
        redraw();
        syncAnnotatedFlag();
        return;
    }
    if (!dragging) {
        return;
    }
    if (actionBar.contains(event.target)) {
        dragging = false;
        return;
    }
    dragging = false;
    currentRect = updateRect({ x: event.clientX, y: event.clientY });
    renderSelection(currentRect);
    if (currentRect && currentRect.width > 4 && currentRect.height > 4) {
        await window.bridge.setSelection({ type: 'update', rect: currentRect });
        overlayText.textContent = 'Seçim hazır. Çiz (kalem/kutu/karart) ya da gönder:';
        actionBar.classList.remove('hidden');
        showToolbarIfReady();
    }
    else {
        currentRect = null;
        startPoint = null;
        renderSelection(null);
        document.body.classList.remove('selecting');
        overlayText.textContent = 'Ekranı sürükleyerek bir alan seçin.';
        toolbarEl.classList.add('hidden');
    }
});
window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
});
// ── Toolbar buttons ──────────────────────────────────────────────
toolButtons.pen.addEventListener('click', (e) => {
    e.stopPropagation();
    setTool(currentTool === 'pen' ? null : 'pen');
});
toolButtons.box.addEventListener('click', (e) => {
    e.stopPropagation();
    setTool(currentTool === 'box' ? null : 'box');
});
toolButtons.redact.addEventListener('click', (e) => {
    e.stopPropagation();
    setTool(currentTool === 'redact' ? null : 'redact');
});
btnColor.addEventListener('click', (e) => {
    e.stopPropagation();
    currentColor =
        currentColor === '#ff3b30' ? '#ffd60a' : currentColor === '#ffd60a' ? '#34c759' : '#ff3b30';
    btnColor.style.color = currentColor;
});
btnUndo.addEventListener('click', (e) => {
    e.stopPropagation();
    annotations.pop();
    redraw();
    syncAnnotatedFlag();
});
btnClear.addEventListener('click', (e) => {
    e.stopPropagation();
    annotations.length = 0;
    setTool(null);
    redraw();
    syncAnnotatedFlag();
});
// ── Action buttons (unchanged) ───────────────────────────────────
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
// ── Composite the selection + annotations into a PNG for main ────
window.__ctrl2phoneCompose = () => {
    return new Promise((resolve) => {
        if (!currentRect || annotations.length === 0 || !bgDataUrl) {
            resolve(null);
            return;
        }
        const r = currentRect;
        const img = new Image();
        img.onload = () => {
            try {
                const scaleX = img.naturalWidth / window.innerWidth;
                const scaleY = img.naturalHeight / window.innerHeight;
                const w = Math.max(1, Math.round(r.width * scaleX));
                const h = Math.max(1, Math.round(r.height * scaleY));
                const out = document.createElement('canvas');
                out.width = w;
                out.height = h;
                const octx = out.getContext('2d');
                // 1) the selection region of the frozen background
                octx.drawImage(img, r.x * scaleX, r.y * scaleY, r.width * scaleX, r.height * scaleY, 0, 0, w, h);
                // 2) the same region of the annotation canvas, burned on top
                octx.drawImage(annotationCanvas, r.x, r.y, r.width, r.height, 0, 0, w, h);
                resolve(out.toDataURL('image/png'));
            }
            catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = bgDataUrl;
    });
};
// ── Bridge state ─────────────────────────────────────────────────
window.bridge.onOverlayState((state) => {
    active = Boolean(state?.active);
    selectionBox.classList.toggle('hidden', !state?.visible);
    // Ensure the annotation canvas matches the (just-resized) window size; the
    // window 'resize' event is unreliable across hide/show.
    if (active) {
        resizeCanvas();
    }
    if (state?.backgroundImage) {
        bgDataUrl = state.backgroundImage;
        document.body.style.backgroundImage = `url("${state.backgroundImage}")`;
    }
    else {
        bgDataUrl = null;
        document.body.style.backgroundImage = 'none';
    }
    if (!active) {
        // Session ended — clear everything, including annotations.
        dragging = false;
        startPoint = null;
        document.body.classList.remove('selecting');
        actionBar.classList.add('hidden');
        toolbarEl.classList.add('hidden');
        annotations.length = 0;
        annotatedFlag = false;
        setTool(null);
        redraw();
    }
    if (state?.selection) {
        currentRect = state.selection;
        renderSelection(currentRect);
        document.body.classList.add('selecting');
        actionBar.classList.remove('hidden');
        showToolbarIfReady();
    }
    else if (!dragging) {
        currentRect = null;
        renderSelection(null);
        actionBar.classList.add('hidden');
        if (!active) {
            toolbarEl.classList.add('hidden');
        }
    }
});
window.bridge.onOverlayMessage((message) => {
    overlayText.textContent = message;
});
