const promptInput = document.getElementById('prompt') as HTMLTextAreaElement;
const supabaseUrlInput = document.getElementById('supabaseUrl') as HTMLInputElement;
const supabaseKeyInput = document.getElementById('supabaseKey') as HTMLInputElement;
const supabaseBucketInput = document.getElementById('supabaseBucket') as HTMLInputElement;
const autoCopyFromPhoneInput = document.getElementById('autoCopyFromPhone') as HTMLInputElement;
const hotkeyVkInput = document.getElementById('hotkeyVk') as HTMLSelectElement;
const doublePressMsInput = document.getElementById('doublePressMs') as HTMLInputElement;
const statusNode = document.getElementById('status') as HTMLElement;
const responseNode = document.getElementById('response') as HTMLElement;
const qrCodeImage = document.getElementById('qrCodeImage') as HTMLImageElement;

const storageContainer = document.getElementById('storageContainer') as HTMLElement;
const storageText = document.getElementById('storageText') as HTMLElement;
const storageBar = document.getElementById('storageBar') as HTMLElement;

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

async function updateStorageUsage(): Promise<void> {
  try {
    const result = await window.bridge.getStorageUsage();
    if (
      result?.ok &&
      typeof result.usedBytes === 'number' &&
      typeof result.limitBytes === 'number'
    ) {
      const usedMb = result.usedBytes / (1024 * 1024);
      const limitMb = result.limitBytes / (1024 * 1024);
      const pct = result.usedPercentage ?? 0;

      storageText.textContent = `${usedMb.toFixed(1)} MB / ${limitMb.toFixed(0)} MB (${pct.toFixed(1)}%)`;
      storageBar.style.width = `${Math.min(pct, 100)}%`;

      if (pct > 90) {
        storageBar.style.backgroundColor = '#ef4444'; // Red
      } else if (pct > 75) {
        storageBar.style.backgroundColor = '#f97316'; // Orange
      } else {
        storageBar.style.backgroundColor = '#3b82f6'; // Blue
      }

      storageContainer.style.display = 'block';
    } else {
      storageContainer.style.display = 'none';
    }
  } catch (e) {
    console.error('Storage query error:', e);
    storageContainer.style.display = 'none';
  }
}

function loadSettings(state: any): void {
  promptInput.value = state.prompt || '';
  supabaseUrlInput.value = state.supabaseUrl || '';
  supabaseKeyInput.value = state.supabaseKey || '';
  supabaseBucketInput.value = state.supabaseBucket || 'screenshots';
  if (autoCopyFromPhoneInput) {
    autoCopyFromPhoneInput.checked = state.autoCopyFromPhone !== false;
  }
  if (hotkeyVkInput) {
    hotkeyVkInput.value = String(state.hotkeyVk ?? 162);
  }
  if (doublePressMsInput) {
    doublePressMsInput.value = String(state.doublePressMs ?? 400);
  }
  statusNode.textContent = state.selectionActive ? 'Seçim modu açık' : 'Hazır';
  updateQrCode();
  updateStorageUsage();
}

window.bridge.ready().then(loadSettings);

window.bridge.onStatus((message) => {
  statusNode.textContent = message;
});

window.bridge.onResponse((message) => {
  responseNode.textContent = message;
  // Trigger storage update whenever we finish sending something
  updateStorageUsage();
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
    autoCopyFromPhone: autoCopyFromPhoneInput ? autoCopyFromPhoneInput.checked : true,
    hotkeyVk: parseInt(hotkeyVkInput?.value ?? '162', 10) || 162,
    // Clamp to the range the C# listener accepts so the persisted/displayed value
    // can never diverge from the threshold actually in effect.
    doublePressMs: Math.min(
      2000,
      Math.max(100, parseInt(doublePressMsInput?.value ?? '400', 10) || 400)
    ),
  };

  const result = await window.bridge.saveSettings(payload);

  if (result?.ok) {
    statusNode.textContent = 'Ayarlar kaydedildi';
    updateQrCode();
    updateStorageUsage();
  }
});

document.getElementById('setupRls')?.addEventListener('click', async () => {
  statusNode.textContent = 'RLS SQL panoya kopyalanıyor...';
  try {
    const result = await window.bridge.setupRls();
    if (result?.ok) {
      statusNode.textContent =
        "RLS SQL panoya kopyalandı. Açılan Supabase SQL Editör'e yapıştırıp Run deyin.";
      if (result.sql) {
        responseNode.textContent =
          "Aşağıdaki SQL panoya kopyalandı — Supabase SQL Editör'e yapıştırıp Run deyin:\n\n" +
          result.sql;
      }
    } else {
      statusNode.textContent = `RLS kurulum hatası: ${result?.error || 'Bilinmeyen hata'}`;
    }
  } catch (e: any) {
    statusNode.textContent = `Hata: ${e.message}`;
  }
});

document.getElementById('purgeStorage')?.addEventListener('click', async () => {
  const confirmClean = confirm(
    'Supabase storage bucket içerisindeki tüm görseller (to_pc dahil) KALICI OLARAK silinecektir. Emin misiniz?'
  );
  if (!confirmClean) return;

  statusNode.textContent = 'Temizleniyor...';
  try {
    const result = await window.bridge.purgeStorage();
    if (result?.ok) {
      statusNode.textContent = `Temizlik başarılı (${result.deletedCount ?? 0} dosya silindi)`;
      updateStorageUsage();
    } else {
      statusNode.textContent = `Temizlik hatası: ${result?.error || 'Bilinmeyen hata'}`;
    }
  } catch (e: any) {
    statusNode.textContent = `Hata: ${e.message}`;
  }
});
