const promptInput = document.getElementById('prompt') as HTMLTextAreaElement;
const supabaseUrlInput = document.getElementById('supabaseUrl') as HTMLInputElement;
const supabaseKeyInput = document.getElementById('supabaseKey') as HTMLInputElement;
const supabaseBucketInput = document.getElementById('supabaseBucket') as HTMLInputElement;
const autoCopyFromPhoneInput = document.getElementById('autoCopyFromPhone') as HTMLInputElement;
const hotkeyVkInput = document.getElementById('hotkeyVk') as HTMLSelectElement;
const doublePressMsInput = document.getElementById('doublePressMs') as HTMLInputElement;
const aiProviderInput = document.getElementById('aiProvider') as HTMLSelectElement;
const aiApiKeyInput = document.getElementById('aiApiKey') as HTMLInputElement;
const aiModelInput = document.getElementById('aiModel') as HTMLInputElement;
const aiBaseUrlInput = document.getElementById('aiBaseUrl') as HTMLInputElement;
const aiBaseUrlRow = document.getElementById('aiBaseUrlRow') as HTMLElement;
const uiLanguageInput = document.getElementById('uiLanguage') as HTMLSelectElement;
const statusNode = document.getElementById('status') as HTMLElement;
const responseNode = document.getElementById('response') as HTMLElement;
const qrCodeImage = document.getElementById('qrCodeImage') as HTMLImageElement;

const storageContainer = document.getElementById('storageContainer') as HTMLElement;
const storageText = document.getElementById('storageText') as HTMLElement;
const storageBar = document.getElementById('storageBar') as HTMLElement;

// Active translation map (resolved by the main process and delivered via ready()).
let currentI18n: Record<string, string> = {};

function t(key: string, fallback: string): string {
  return currentI18n[key] ?? fallback;
}

// Replace text/placeholders of every [data-i18n] / [data-i18n-ph] element. Elements
// keep their hard-coded text as the ultimate fallback when a key is missing.
function applyI18n(dict: Record<string, string>): void {
  currentI18n = dict || {};
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key && currentI18n[key] != null) {
      el.textContent = currentI18n[key];
    }
  });
  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-ph]')
    .forEach((el) => {
      const key = el.getAttribute('data-i18n-ph');
      if (key && currentI18n[key] != null) {
        el.placeholder = currentI18n[key];
      }
    });
  if (currentI18n['app.title']) {
    document.title = currentI18n['app.title'];
  }
  if (currentI18n['meta.lang']) {
    document.documentElement.lang = currentI18n['meta.lang'];
  }
}

// #status and #response carry live runtime content (AI replies, OCR text, signed
// URLs, the RLS SQL). Once real content has been shown, loadSettings must not reset
// them to their localized placeholder on a language switch — these flags track that.
let statusDirty = false;
let responseDirty = false;

function showStatus(text: string): void {
  statusDirty = true;
  statusNode.textContent = text;
}

function showResponse(text: string): void {
  responseDirty = true;
  responseNode.textContent = text;
}

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
  applyI18n(state.i18n || {});
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
  if (aiProviderInput) {
    aiProviderInput.value = state.aiProvider || 'web';
  }
  if (aiApiKeyInput) {
    aiApiKeyInput.value = state.aiApiKey || '';
  }
  if (aiModelInput) {
    aiModelInput.value = state.aiModel || '';
  }
  if (aiBaseUrlInput) {
    aiBaseUrlInput.value = state.aiBaseUrl || '';
  }
  if (uiLanguageInput) {
    uiLanguageInput.value = state.language || 'system';
  }
  updateAiProviderUi();
  // Only (re)apply the localized placeholders while no live runtime message is shown,
  // so switching language never wipes an AI reply / signed URL / OCR text.
  if (!statusDirty) {
    statusNode.textContent = state.selectionActive
      ? t('status.selectionActive', 'Seçim modu açık')
      : t('status.ready', 'Hazır');
  }
  if (!responseDirty) {
    responseNode.textContent = t('response.placeholder', 'Yapay zekâ yanıtı burada görünecek.');
  }
  updateQrCode();
  updateStorageUsage();
}

// Base URL only matters for the OpenAI-compatible 'custom' provider.
function updateAiProviderUi(): void {
  if (!aiProviderInput || !aiBaseUrlRow) return;
  aiBaseUrlRow.style.display = aiProviderInput.value === 'custom' ? '' : 'none';
}

aiProviderInput?.addEventListener('change', updateAiProviderUi);

// Switching the interface language persists it and re-renders from the freshly
// resolved string map the main process returns.
uiLanguageInput?.addEventListener('change', async () => {
  await window.bridge.saveSettings({
    language: (uiLanguageInput.value as 'system' | 'en' | 'tr') || 'system',
  });
  const state = await window.bridge.ready();
  loadSettings(state);
});

window.bridge.ready().then(loadSettings);

window.bridge.onStatus((message) => {
  showStatus(message);
});

window.bridge.onResponse((message) => {
  showResponse(message);
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
    aiProvider:
      (aiProviderInput?.value as 'web' | 'gemini' | 'claude' | 'openai' | 'custom') || 'web',
    aiApiKey: aiApiKeyInput?.value.trim() ?? '',
    aiModel: aiModelInput?.value.trim() ?? '',
    aiBaseUrl: aiBaseUrlInput?.value.trim() ?? '',
    language: (uiLanguageInput?.value as 'system' | 'en' | 'tr') || 'system',
  };

  const result = await window.bridge.saveSettings(payload);

  if (result?.ok) {
    showStatus(t('status.settingsSaved', 'Ayarlar kaydedildi'));
    updateQrCode();
    updateStorageUsage();
  }
});

document.getElementById('setupRls')?.addEventListener('click', async () => {
  showStatus(t('status.rlsCopying', 'RLS SQL panoya kopyalanıyor...'));
  try {
    const result = await window.bridge.setupRls();
    if (result?.ok) {
      showStatus(
        t(
          'status.rlsCopied',
          "RLS SQL panoya kopyalandı. Açılan Supabase SQL Editör'e yapıştırıp Run deyin."
        )
      );
      if (result.sql) {
        showResponse(
          t(
            'response.rlsPrefix',
            "Aşağıdaki SQL panoya kopyalandı — Supabase SQL Editör'e yapıştırıp Run deyin:\n\n"
          ) + result.sql
        );
      }
    } else {
      showStatus(
        t('status.rlsError', 'RLS kurulum hatası: ') +
          (result?.error || t('status.unknownError', 'Bilinmeyen hata'))
      );
    }
  } catch (e: any) {
    showStatus(t('status.genericError', 'Hata: ') + e.message);
  }
});

document.getElementById('purgeStorage')?.addEventListener('click', async () => {
  const confirmClean = confirm(
    t(
      'confirm.purge',
      'Supabase storage bucket içerisindeki tüm görseller (to_pc dahil) KALICI OLARAK silinecektir. Emin misiniz?'
    )
  );
  if (!confirmClean) return;

  showStatus(t('status.purging', 'Temizleniyor...'));
  try {
    const result = await window.bridge.purgeStorage();
    if (result?.ok) {
      showStatus(
        t('status.purgeDone', 'Temizlik başarılı ({n} dosya silindi)').replace(
          '{n}',
          String(result.deletedCount ?? 0)
        )
      );
      updateStorageUsage();
    } else {
      showStatus(
        t('status.purgeError', 'Temizlik hatası: ') +
          (result?.error || t('status.unknownError', 'Bilinmeyen hata'))
      );
    }
  } catch (e: any) {
    showStatus(t('status.genericError', 'Hata: ') + e.message);
  }
});

document.getElementById('sendClipboard')?.addEventListener('click', async () => {
  showStatus(t('status.sendingClipboard', 'Metin telefona gönderiliyor...'));
  try {
    const result = await window.bridge.sendClipboard();
    if (!result?.ok) {
      showStatus(
        t('status.sendClipboardError', 'Gönderim hatası: ') +
          (result?.error || t('status.unknownError', 'Bilinmeyen hata'))
      );
    }
  } catch (e: any) {
    showStatus(t('status.genericError', 'Hata: ') + e.message);
  }
});
