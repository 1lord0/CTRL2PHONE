const promptInput = document.getElementById('prompt') as HTMLTextAreaElement;
const supabaseUrlInput = document.getElementById('supabaseUrl') as HTMLInputElement;
const supabaseKeyInput = document.getElementById('supabaseKey') as HTMLInputElement;
const supabaseBucketInput = document.getElementById('supabaseBucket') as HTMLInputElement;
const statusNode = document.getElementById('status') as HTMLElement;
const responseNode = document.getElementById('response') as HTMLElement;
const qrCodeImage = document.getElementById('qrCodeImage') as HTMLImageElement;

async function updateQrCode(): Promise<void> {
  try {
    const result = await window.bridge.generateQr();
    if (result?.ok && result.dataUrl) {
      qrCodeImage.src = result.dataUrl;
      qrCodeImage.style.display = 'block';
    } else {
      qrCodeImage.style.display = 'none';
    }
  } catch (e) {
    console.error('QR Kod yükleme hatası:', e);
    qrCodeImage.style.display = 'none';
  }
}

function loadSettings(state: any): void {
  promptInput.value = state.prompt || '';
  supabaseUrlInput.value = state.supabaseUrl || '';
  supabaseKeyInput.value = state.supabaseKey || '';
  supabaseBucketInput.value = state.supabaseBucket || 'screenshots';
  statusNode.textContent = state.selectionActive ? 'Seçim modu açık' : 'Hazır';
  updateQrCode();
}

window.bridge.ready().then(loadSettings);

window.bridge.onStatus((message) => {
  statusNode.textContent = message;
});

window.bridge.onResponse((message) => {
  responseNode.textContent = message;
});

window.bridge.onOverlayMessage((message) => {
  const overlayText = document.getElementById('overlayText');
  if (overlayText) {
    overlayText.textContent = message;
  }
});

document.getElementById('saveSettings')?.addEventListener('click', async () => {
  const payload = {
    prompt: promptInput.value.trim(),
    supabaseUrl: supabaseUrlInput.value.trim(),
    supabaseKey: supabaseKeyInput.value.trim(),
    supabaseBucket: supabaseBucketInput.value.trim() || 'screenshots',
  };

  const result = await window.bridge.saveSettings(payload);

  if (result?.ok) {
    statusNode.textContent = 'Ayarlar kaydedildi';
    updateQrCode();
  }
});
