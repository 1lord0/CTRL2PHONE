const promptInput = document.getElementById('prompt');
const supabaseUrlInput = document.getElementById('supabaseUrl');
const supabaseKeyInput = document.getElementById('supabaseKey');
const supabaseBucketInput = document.getElementById('supabaseBucket');
const statusNode = document.getElementById('status');
const responseNode = document.getElementById('response');

const qrCodeImage = document.getElementById('qrCodeImage');

async function updateQrCode() {
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

function loadSettings(state) {
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

document.getElementById('saveSettings').addEventListener('click', async () => {
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
