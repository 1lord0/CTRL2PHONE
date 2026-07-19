// NOT: Bu dosya bilinçli olarak global script'tir (overlay.ts gibi) — `export {}`
// eklemeyin! Modül yapmak tsc'ye CommonJS önsözü (`exports` referansı) yazdırır ve
// script tarayıcıda "exports is not defined" ile ilk satırda ölür. Üst düzey isimler
// renderer.ts/overlay.ts ile çakışmamalıdır (bu yüzden pill* önekleri kullanılıyor).

// Cast bridge to MainBridgeAPI since pill renderer is a global script and cannot import types
const pillBridge = (window as any).bridge as import('./types').MainBridgeAPI;

const pillHud = document.getElementById('pillHud') as HTMLElement;
const pillOpenBtn = document.getElementById('pillOpen') as HTMLButtonElement;
const pillStatusNode = document.getElementById('pillStatus') as HTMLElement;

let pillI18n: Record<string, string> = {};

function pillT(key: string, fallback: string): string {
  return pillI18n[key] ?? fallback;
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

  const downloadsNode = document.getElementById('pillDownloads');
  const downloadsW = downloadsNode ? downloadsNode.getBoundingClientRect().width : 0;

  const chromeW = PILL_CHROME_PAD_X + 4 + (downloadsW > 0 ? downloadsW + 12 : 0);
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
    const overflows = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
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
    const sample = text ?? pillStatusNode?.textContent ?? pillT('status.ready', 'Hazır');
    const size = measureCompactStatus(sample);
    void pillBridge.panelResizeCompact(size).then(() => updateCompactOverflow());
  }, 32);
}

function showPillStatus(text: string): void {
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

interface DownloadedFile {
  path: string;
  name: string;
  isImage: boolean;
}

const pillDownloads = document.getElementById('pillDownloads') as HTMLElement;

function renderDownloads(files: DownloadedFile[]): void {
  if (!pillDownloads) return;
  pillDownloads.innerHTML = '';

  files.forEach((file) => {
    const item = document.createElement('div');
    item.className = 'download-item';
    item.setAttribute('draggable', 'true');
    item.title = file.name;

    const span = document.createElement('span');
    span.className = 'file-icon';
    const parts = file.name.split('.');
    span.textContent = parts[parts.length - 1] || '???';
    item.appendChild(span);

    item.addEventListener('dragstart', (e) => {
      e.preventDefault();
      pillBridge.startDragDownloadedFile(file.path);
    });

    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'download-item-delete';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.title = 'Sil';
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void pillBridge.deleteDownloadedFile(file.path);
    });

    item.appendChild(deleteBtn);
    pillDownloads.appendChild(item);
  });

  scheduleCompactPillResize();
}

function bindPillUi(): void {
  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.download-item')) return;
    void pillBridge.panelInteractStart();
  };

  const onHudClick = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest('#pillOpen')) return;
    if ((e.target as HTMLElement).closest('.download-item')) return;
    e.preventDefault();
    void pillBridge.panelToggle();
  };

  pillHud?.addEventListener('mousedown', onMouseDown, true);
  pillHud?.addEventListener('click', onHudClick, true);

  pillOpenBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void pillBridge.panelToggle();
  });

  pillHud?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void pillBridge.panelToggle();
    }
  });
  pillHud?.setAttribute('tabindex', '0');

  const shell = document.getElementById('pillShell');
  if (shell) {
    shell.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      shell.classList.add('is-drag-over');
    });

    shell.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      shell.classList.add('is-drag-over');
    });

    shell.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      shell.classList.remove('is-drag-over');
    });

    shell.addEventListener('dragend', () => {
      shell.classList.remove('is-drag-over');
    });

    shell.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      shell.classList.remove('is-drag-over');

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i];
          if (file && file.path) {
            void pillBridge.uploadFileToPhone(file.path);
          }
        }
      }
    });
  }

  pillBridge.onHudCapturing((active: any) => {
    pillHud?.classList.toggle('is-capturing', active);
  });

  pillBridge.onPillResized((size: any) => {
    applyPillGeometry(size);
    updateCompactOverflow();
  });
  window.addEventListener('resize', () => {
    applyPillGeometry();
    scheduleCompactPillResize();
  });
  pillBridge.onStatus((message: any) => showPillStatus(message));
  pillBridge.onPhoneDownloadsUpdated((files: any) => renderDownloads(files));
}

bindPillUi();

pillBridge.ready().then((state: any) => {
  pillI18n = state.i18n || {};
  if (typeof state.pillMaxWidth === 'number' && state.pillMaxWidth > 0) {
    pillMaxWidth = state.pillMaxWidth;
  }
  const readyText = state.selectionActive
    ? pillT('status.selectionActive', 'Seçim modu açık')
    : pillT('status.ready', 'Hazır');
  if (pillStatusNode) {
    pillStatusNode.textContent = readyText.replace(/\s+/g, ' ').trim();
    pillStatusNode.title = pillStatusNode.textContent;
    applyPillGeometry();
    if (state.phoneDownloads) {
      renderDownloads(state.phoneDownloads);
    } else {
      scheduleCompactPillResize(pillStatusNode.textContent);
    }
  }
});
