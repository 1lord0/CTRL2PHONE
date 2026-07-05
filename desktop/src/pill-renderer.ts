const pillHud = document.getElementById('pillHud') as HTMLElement;
const pillOpenBtn = document.getElementById('pillOpen') as HTMLButtonElement;
const pillStatusNode = document.getElementById('pillStatus') as HTMLElement;

const PILL_DRAG_SLOP = 10;

let currentI18n: Record<string, string> = {};

function t(key: string, fallback: string): string {
  return currentI18n[key] ?? fallback;
}

const PILL_ICON = 28;
const PILL_GAP = 10;
const PILL_PAD_LEFT = 12;
const PILL_PAD_RIGHT = 16;
const PILL_CHROME_PAD_X = PILL_PAD_LEFT + PILL_ICON + PILL_GAP + PILL_PAD_RIGHT;
const PILL_MIN_W = 220;
const PILL_MIN_H = 44;
const PILL_MAX_H = 80;
const PILL_CHROME_PAD_Y = 12;

let pillMaxWidth = 720;
let compactMeasureNode: HTMLSpanElement | null = null;
let compactResizeTimer: ReturnType<typeof setTimeout> | null = null;

function pillRadiusFor(height: number): number {
  return Math.max(8, Math.floor(height / 2));
}

function applyPillGeometry(size?: { width?: number; height?: number }): void {
  const h = Math.round(size?.height ?? window.innerHeight);
  const r = pillRadiusFor(h);
  document.documentElement.style.setProperty('--pill-radius', `${r}px`);
}

function measureCompactStatus(text: string): { width: number; height: number } {
  if (!compactMeasureNode) {
    compactMeasureNode = document.createElement('span');
    compactMeasureNode.className = 'pill-status-measure';
    compactMeasureNode.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
    document.body.appendChild(compactMeasureNode);
  }

  const sample = text.replace(/\s+/g, ' ').trim() || ' ';
  compactMeasureNode.textContent = sample;
  compactMeasureNode.style.maxWidth = 'none';
  compactMeasureNode.style.whiteSpace = 'nowrap';
  compactMeasureNode.style.display = 'inline-block';

  const singleLineW = compactMeasureNode.scrollWidth;
  const singleLineH = compactMeasureNode.offsetHeight;
  const chromeW = PILL_CHROME_PAD_X + 4;
  const textSlotMax = pillMaxWidth - chromeW;

  if (singleLineW <= textSlotMax) {
    return {
      width: Math.min(pillMaxWidth, Math.max(PILL_MIN_W, chromeW + singleLineW)),
      height: Math.min(PILL_MAX_H, Math.max(PILL_MIN_H, singleLineH + PILL_CHROME_PAD_Y)),
    };
  }

  compactMeasureNode.style.whiteSpace = 'normal';
  compactMeasureNode.style.display = '-webkit-box';
  compactMeasureNode.style.webkitBoxOrient = 'vertical';
  compactMeasureNode.style.webkitLineClamp = '2';
  compactMeasureNode.style.maxWidth = `${textSlotMax}px`;

  const wrappedH = compactMeasureNode.scrollHeight;
  return {
    width: pillMaxWidth,
    height: Math.min(PILL_MAX_H, Math.max(PILL_MIN_H, wrappedH + PILL_CHROME_PAD_Y)),
  };
}

function updateCompactOverflow(): void {
  if (!pillStatusNode) return;
  requestAnimationFrame(() => {
    const el = pillStatusNode;
    const overflows =
      el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    el.classList.toggle('is-overflow', overflows);
    if (overflows) {
      el.style.setProperty('--marquee-end', `-${Math.max(0, el.scrollWidth - el.clientWidth)}px`);
    } else {
      el.style.removeProperty('--marquee-end');
    }
  });
}

function scheduleCompactPillResize(text?: string): void {
  if (compactResizeTimer) clearTimeout(compactResizeTimer);
  compactResizeTimer = setTimeout(() => {
    compactResizeTimer = null;
    const sample = text ?? pillStatusNode?.textContent ?? t('status.ready', 'Hazır');
    const size = measureCompactStatus(sample);
    void window.bridge.panelResizeCompact(size).then(() => updateCompactOverflow());
  }, 32);
}

function showStatus(text: string): void {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (pillStatusNode) {
    pillStatusNode.textContent = oneLine;
    pillStatusNode.title = oneLine;
  }
  scheduleCompactPillResize(oneLine);
  updateCompactOverflow();
  pillHud?.classList.add('is-active');
  setTimeout(() => pillHud?.classList.remove('is-active'), 2400);
}

function bindPillUi(): void {
  let pressing = false;
  let dragging = false;
  let didDrag = false;
  let pressScreenX = 0;
  let pressScreenY = 0;
  let lastScreenX = 0;
  let lastScreenY = 0;

  const endPress = (): void => {
    if (!pressing) return;
    pressing = false;
    dragging = false;
    pillHud?.classList.remove('is-dragging');
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    void window.bridge.panelInteractStart();
    pressing = true;
    dragging = false;
    didDrag = false;
    pressScreenX = e.screenX;
    pressScreenY = e.screenY;
    lastScreenX = e.screenX;
    lastScreenY = e.screenY;
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!pressing) return;
    if (
      !dragging &&
      Math.hypot(e.screenX - pressScreenX, e.screenY - pressScreenY) >= PILL_DRAG_SLOP
    ) {
      dragging = true;
      didDrag = true;
      pillHud?.classList.add('is-dragging');
    }
    if (!dragging) return;
    const dx = e.screenX - lastScreenX;
    const dy = e.screenY - lastScreenY;
    if (dx !== 0 || dy !== 0) {
      void window.bridge.panelDragBy(dx, dy);
      lastScreenX = e.screenX;
      lastScreenY = e.screenY;
    }
  };

  const onMouseUp = (): void => {
    endPress();
  };

  const onHudClick = (e: MouseEvent): void => {
    if (didDrag) {
      didDrag = false;
      return;
    }
    if ((e.target as HTMLElement).closest('#pillOpen')) return;
    e.preventDefault();
    void window.bridge.panelToggle();
  };

  // Capture fazı: pill'in her yerinde tıklama + sürükleme.
  pillHud?.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  pillHud?.addEventListener('click', onHudClick, true);

  pillOpenBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void window.bridge.panelToggle();
  });

  pillHud?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void window.bridge.panelToggle();
    }
  });
  pillHud?.setAttribute('tabindex', '0');

  window.bridge.onHudCapturing((active) => {
    pillHud?.classList.toggle('is-capturing', active);
  });

  window.bridge.onPillResized((size) => {
    applyPillGeometry(size);
    updateCompactOverflow();
  });
  window.addEventListener('resize', () => {
    applyPillGeometry();
    scheduleCompactPillResize();
  });
  window.bridge.onStatus((message) => showStatus(message));
}

bindPillUi();

window.bridge.ready().then((state) => {
  currentI18n = state.i18n || {};
  if (typeof state.pillMaxWidth === 'number' && state.pillMaxWidth > 0) {
    pillMaxWidth = state.pillMaxWidth;
  }
  const readyText = state.selectionActive
    ? t('status.selectionActive', 'Seçim modu açık')
    : t('status.ready', 'Hazır');
  if (pillStatusNode) {
    pillStatusNode.textContent = readyText.replace(/\s+/g, ' ').trim();
    pillStatusNode.title = pillStatusNode.textContent;
    applyPillGeometry();
    scheduleCompactPillResize(pillStatusNode.textContent);
  }
});

export {};