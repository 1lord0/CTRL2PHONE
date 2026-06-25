const selectionBox = document.getElementById('selectionBox');
const overlayText = document.getElementById('overlayText');

let active = false;
let dragging = false;
let startPoint = null;
let currentRect = null;

function renderSelection(rect) {
  if (!rect) {
    selectionBox.classList.add('hidden');
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

  dragging = true;
  startPoint = { x: event.clientX, y: event.clientY };
  currentRect = { x: startPoint.x, y: startPoint.y, width: 0, height: 0 };
  overlayText.textContent = 'Sürükle ve bırak, sonra X veya Enter ile gönder';
  renderSelection(currentRect);
  window.bridge.setSelection({ type: 'start' });
});

window.addEventListener('mouseup', async (event) => {
  if (!active || event.button !== 0 || !dragging) {
    return;
  }

  dragging = false;
  currentRect = updateRect({ x: event.clientX, y: event.clientY });
  renderSelection(currentRect);

  if (currentRect && currentRect.width > 4 && currentRect.height > 4) {
    await window.bridge.setSelection({ type: 'update', rect: currentRect });
    overlayText.textContent = 'Seçim hazır. X veya Enter ile gönder, Esc ile iptal et.';
  } else {
    currentRect = null;
    startPoint = null;
    renderSelection(null);
    overlayText.textContent = 'En az bir alan seç';
  }
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

window.bridge.onOverlayState((state) => {
  active = Boolean(state?.active);
  selectionBox.classList.toggle('hidden', !state?.visible);

  if (state?.backgroundImage) {
    document.body.style.backgroundImage = `url("${state.backgroundImage}")`;
  } else {
    document.body.style.backgroundImage = 'none';
  }

  if (!active) {
    dragging = false;
    startPoint = null;
  }

  if (state?.selection) {
    currentRect = state.selection;
    renderSelection(currentRect);
  } else if (!dragging) {
    currentRect = null;
    renderSelection(null);
  }
});

window.bridge.onOverlayMessage((message) => {
  overlayText.textContent = message;
});