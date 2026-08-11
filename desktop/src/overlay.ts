// Cast bridge to OverlayBridgeAPI since overlay renderer is a global script and cannot import types
const overlayBridge = (window as any).bridge as import('./types').OverlayBridgeAPI;

const selectionBox = document.getElementById('selectionBox') as HTMLElement;
const overlayText = document.getElementById('overlayText') as HTMLElement;
const actionBar = document.getElementById('actionBar') as HTMLElement;
const btnAction = document.getElementById('btnAction') as HTMLButtonElement;
const btnGemini = document.getElementById('btnGemini') as HTMLButtonElement;
const btnPhone = document.getElementById('btnPhone') as HTMLButtonElement;
const btnOcr = document.getElementById('btnOcr') as HTMLButtonElement;
const btnCancel = document.getElementById('btnCancel') as HTMLButtonElement;
const btnCopy = document.getElementById('btnCopy') as HTMLButtonElement;

// ── Annotation layer ─────────────────────────────────────────────
const annotationCanvas = document.getElementById('annotationCanvas') as HTMLCanvasElement;
const actx = annotationCanvas.getContext('2d') as CanvasRenderingContext2D;
const toolbarEl = document.getElementById('annotationToolbar') as HTMLElement;
const toolButtons: Record<string, HTMLButtonElement> = {
  pen: document.getElementById('toolPen') as HTMLButtonElement,
  box: document.getElementById('toolBox') as HTMLButtonElement,
  redact: document.getElementById('toolRedact') as HTMLButtonElement,
};
const btnColor = document.getElementById('toolColor') as HTMLButtonElement;
const btnUndo = document.getElementById('toolUndo') as HTMLButtonElement;
const btnClear = document.getElementById('toolClear') as HTMLButtonElement;

type Tool = 'pen' | 'box' | 'redact';
type Pt = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
type Annotation =
  | { type: 'pen'; color: string; points: Pt[] }
  | { type: 'box'; color: string; rect: Box }
  | { type: 'redact'; rect: Box };

let active = false;
let dragging = false;
let startPoint: Pt | null = null;
let currentRect: Box | null = null;

let currentTool: Tool | null = null;
let currentColor = '#ff3b30';
const annotations: Annotation[] = [];
let drawing = false;
let drawStart: Pt | null = null;
let liveStroke: Pt[] | null = null;
let annotatedFlag = false;
let bgDataUrl: string | null = null;
let activeSessionId: number | null = null;
let dragProxyReady = false;

function observeHandshake(
  phase: 'ready' | 'rendered',
  acknowledgement: Promise<{ ok: boolean }>
): void {
  void acknowledgement
    .then((result) => {
      if (!result.ok) {
        console.error(`[overlay] ${phase} handshake was rejected by the main process`);
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[overlay] ${phase} handshake failed: ${message}`);
    });
}

function boxFrom(a: Pt, b: Pt): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function syncAnnotatedFlag(): void {
  const has = annotations.length > 0;
  if (has !== annotatedFlag) {
    annotatedFlag = has;
    if (activeSessionId !== null) {
      overlayBridge.setAnnotated({ hasAnnotations: has, sessionId: activeSessionId });
    }
  }
}

function drawOne(ctx: CanvasRenderingContext2D, a: Annotation): void {
  if (a.type === 'pen') {
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    a.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  } else if (a.type === 'box') {
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(a.rect.x, a.rect.y, a.rect.width, a.rect.height);
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(a.rect.x, a.rect.y, a.rect.width, a.rect.height);
  }
}

function redraw(preview?: Annotation): void {
  actx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
  for (const a of annotations) drawOne(actx, a);
  if (preview) drawOne(actx, preview);
}

function resizeCanvas(): void {
  annotationCanvas.width = window.innerWidth;
  annotationCanvas.height = window.innerHeight;
  redraw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function setTool(tool: Tool | null): void {
  currentTool = tool;
  for (const key of Object.keys(toolButtons)) {
    toolButtons[key].classList.toggle('active', key === tool);
  }
  document.body.classList.toggle('annotating', tool !== null);
  const isDragReady = dragProxyReady && tool === null;
  selectionBox.draggable = isDragReady;
  selectionBox.classList.toggle('drag-ready', isDragReady);
}

function showToolbarIfReady(): void {
  toolbarEl.classList.toggle('hidden', !(currentRect && active));
}

function positionActionBar(rect: Box): void {
  const gap = 8;
  const viewportPadding = 8;
  const barBounds = actionBar.getBoundingClientRect();
  const barHeight = barBounds.height || 56;
  const barWidth = barBounds.width || actionBar.offsetWidth;
  const topCandidate = rect.y - barHeight - gap;
  const bottomCandidate = rect.y + rect.height + gap;
  const preferredTop = topCandidate >= viewportPadding ? topCandidate : bottomCandidate;
  const top = Math.max(
    viewportPadding,
    Math.min(preferredTop, window.innerHeight - barHeight - viewportPadding)
  );
  const left = Math.max(viewportPadding, rect.x + rect.width - barWidth);
  actionBar.style.top = `${top}px`;
  actionBar.style.left = `${Math.min(left, window.innerWidth - barWidth - viewportPadding)}px`;
}

// ── Selection rendering (unchanged behavior) ─────────────────────
function renderSelection(rect: Box | null): void {
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
  if (!actionBar.classList.contains('hidden')) {
    positionActionBar(rect);
  }
}

function updateRect(endPoint: Pt): Box | null {
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
  const p: Pt = { x: event.clientX, y: event.clientY };

  if (currentTool && drawing) {
    if (currentTool === 'pen' && liveStroke) {
      liveStroke.push(p);
      redraw({ type: 'pen', color: currentColor, points: liveStroke });
    } else if (drawStart) {
      const r = boxFrom(drawStart, p);
      redraw(
        currentTool === 'redact'
          ? { type: 'redact', rect: r }
          : { type: 'box', color: currentColor, rect: r }
      );
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
  if (actionBar.contains(event.target as Node) || toolbarEl.contains(event.target as Node)) {
    return;
  }
  if (dragProxyReady && currentRect && selectionBox.contains(event.target as Node)) {
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
  overlayText.textContent = 'Alanı seçin (X / Enter ile Gemini, A ile Action, M ile Telefon)';
  renderSelection(currentRect);
  if (activeSessionId !== null) {
    overlayBridge.setSelection({ type: 'start', sessionId: activeSessionId });
  }
});

window.addEventListener('mouseup', async (event) => {
  if (!active || event.button !== 0) {
    return;
  }

  // Finishing an annotation stroke/shape.
  if (currentTool && drawing) {
    drawing = false;
    const p: Pt = { x: event.clientX, y: event.clientY };
    if (currentTool === 'pen' && liveStroke && liveStroke.length > 1) {
      annotations.push({ type: 'pen', color: currentColor, points: liveStroke });
    } else if (currentTool !== 'pen' && drawStart) {
      const r = boxFrom(drawStart, p);
      if (r.width > 2 && r.height > 2) {
        annotations.push(
          currentTool === 'redact'
            ? { type: 'redact', rect: r }
            : { type: 'box', color: currentColor, rect: r }
        );
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
  if (actionBar.contains(event.target as Node)) {
    dragging = false;
    return;
  }

  dragging = false;
  currentRect = updateRect({ x: event.clientX, y: event.clientY });
  renderSelection(currentRect);

  if (currentRect && currentRect.width > 4 && currentRect.height > 4) {
    if (activeSessionId !== null) {
      await overlayBridge.setSelection({
        type: 'update',
        rect: currentRect,
        sessionId: activeSessionId,
      });
    }
    overlayText.textContent =
      'Seçim hazır — Kopyala düğmesini kullanın veya görseli tutup sürükleyin.';
    actionBar.classList.remove('hidden');
    positionActionBar(currentRect);
    showToolbarIfReady();
  } else {
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

selectionBox.addEventListener('dragstart', (event) => {
  event.preventDefault();
  if (!active || !dragProxyReady || !currentRect || activeSessionId === null) {
    return;
  }
  overlayBridge.startSelectionDrag(activeSessionId);
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

function bindOverlayAction(btn: HTMLButtonElement, handler: () => void): void {
  let lastAt = 0;
  const run = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - lastAt < 250) return;
    lastAt = now;
    handler();
  };
  btn.addEventListener('pointerup', run);
  btn.addEventListener('click', run);
}

// ── Action buttons ───────────────────────────────────────────────
bindOverlayAction(btnCopy, () => {
  const sessionId = activeSessionId;
  if (sessionId === null || btnCopy.disabled) return;
  btnCopy.disabled = true;
  overlayBridge
    .copySelection(sessionId)
    .then((result) => {
      if (activeSessionId !== sessionId) return;
      if (result.ok) {
        overlayText.textContent =
          'Kopyalandı — görseli tutup başka bir uygulamaya da sürükleyebilirsiniz.';
      } else {
        overlayText.textContent = `Kopyalanamadı: ${result.error || 'Bilinmeyen hata'}`;
      }
    })
    .catch((err: any) => {
      if (activeSessionId !== sessionId) return;
      const errMsg = err instanceof Error ? err.message : String(err);
      overlayText.textContent = `Hata: ${errMsg}`;
    })
    .finally(() => {
      if (activeSessionId === sessionId) {
        btnCopy.disabled = false;
      }
    });
});
const ensureRectSynced = async () => {
  if (activeSessionId !== null && currentRect) {
    await overlayBridge.setSelection({
      type: 'update',
      rect: currentRect,
      sessionId: activeSessionId,
    });
  }
};

bindOverlayAction(btnGemini, async () => {
  if (activeSessionId !== null) {
    await ensureRectSynced();
    overlayBridge.confirmSelectionGemini(activeSessionId);
  }
});
bindOverlayAction(btnAction, async () => {
  if (activeSessionId !== null) {
    await ensureRectSynced();
    overlayBridge.confirmSelectionAction(activeSessionId);
  }
});
bindOverlayAction(btnPhone, async () => {
  if (activeSessionId !== null) {
    await ensureRectSynced();
    overlayBridge.confirmSelectionPhone(activeSessionId);
  }
});
bindOverlayAction(btnOcr, async () => {
  if (activeSessionId !== null) {
    await ensureRectSynced();
    overlayBridge.confirmSelectionOcr(activeSessionId);
  }
});
bindOverlayAction(btnCancel, () => {
  if (activeSessionId !== null) overlayBridge.cancelSelection(activeSessionId);
});

// Klavye kısayolları — key_listener yedek yolu (overlay odakta iken).
window.addEventListener('keydown', (e) => {
  if (!active) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (activeSessionId !== null) overlayBridge.cancelSelection(activeSessionId);
    return;
  }
  if (!currentRect) return;
  if (e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    if (activeSessionId !== null) {
      void ensureRectSynced().then(() => {
        if (activeSessionId !== null) overlayBridge.confirmSelectionAction(activeSessionId);
      });
    }
  } else if (e.key === 'x' || e.key === 'X' || e.key === 'Enter') {
    e.preventDefault();
    if (activeSessionId !== null) {
      void ensureRectSynced().then(() => {
        if (activeSessionId !== null) overlayBridge.confirmSelectionGemini(activeSessionId);
      });
    }
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    if (activeSessionId !== null) {
      void ensureRectSynced().then(() => {
        if (activeSessionId !== null) overlayBridge.confirmSelectionPhone(activeSessionId);
      });
    }
  } else if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    if (activeSessionId !== null) {
      void ensureRectSynced().then(() => {
        if (activeSessionId !== null) overlayBridge.confirmSelectionOcr(activeSessionId);
      });
    }
  }
});

// ── Composite the selection + annotations into a PNG for main ────
window.__ctrl2phoneCompose = () => {
  return new Promise<string | null>((resolve) => {
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
        const octx = out.getContext('2d') as CanvasRenderingContext2D;
        // 1) the selection region of the frozen background
        octx.drawImage(
          img,
          r.x * scaleX,
          r.y * scaleY,
          r.width * scaleX,
          r.height * scaleY,
          0,
          0,
          w,
          h
        );
        // 2) the same region of the annotation canvas, burned on top
        octx.drawImage(annotationCanvas, r.x, r.y, r.width, r.height, 0, 0, w, h);
        resolve(out.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = bgDataUrl;
  });
};

// ── Bridge state ─────────────────────────────────────────────────
overlayBridge.onOverlayState((state: any) => {
  active = Boolean(state?.active);
  activeSessionId = state?.sessionId ?? null;
  selectionBox.classList.toggle('hidden', !state?.visible);

  // Ensure the annotation canvas matches the (just-resized) window size; the
  // window 'resize' event is unreliable across hide/show.
  if (active) {
    resizeCanvas();
  }

  if (state?.backgroundImage) {
    bgDataUrl = state.backgroundImage;
    document.body.style.backgroundImage = `url("${state.backgroundImage}")`;
  } else {
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
    // Reset drag proxy state
    dragProxyReady = false;
    selectionBox.draggable = false;
    selectionBox.classList.remove('drag-ready');
  }

  if (state?.selection) {
    currentRect = state.selection;
    renderSelection(currentRect);
    document.body.classList.add('selecting');
    actionBar.classList.remove('hidden');
    positionActionBar(state.selection);
    showToolbarIfReady();
  } else if (!dragging) {
    currentRect = null;
    renderSelection(null);
    actionBar.classList.add('hidden');
    if (!active) {
      toolbarEl.classList.add('hidden');
    }
  }

  if (state?.visible && state.active && state.sessionId !== null) {
    observeHandshake('rendered', overlayBridge.notifyOverlayRendered(state.sessionId));
  }
});

overlayBridge.onSelectionDragState((data) => {
  if (data.sessionId === activeSessionId) {
    dragProxyReady = data.ready;
    const isReady = data.ready && currentTool === null;
    selectionBox.draggable = isReady;
    selectionBox.classList.toggle('drag-ready', isReady);
  }
});

overlayBridge.onOverlayMessage((message) => {
  overlayText.textContent = message;
});

observeHandshake('ready', overlayBridge.notifyOverlayReady());
