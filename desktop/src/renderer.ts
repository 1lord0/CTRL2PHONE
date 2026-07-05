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
const statusDot = document.getElementById('statusDot') as HTMLElement;
const responseNode = document.getElementById('response') as HTMLElement;
const spotlightPanel = document.getElementById('spotlightPanel') as HTMLElement;
const dismissPanelBtn = document.getElementById('dismissPanel') as HTMLButtonElement;
const pinPanelBtn = document.getElementById('pinPanel') as HTMLButtonElement;
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
let panelPinned = false;

function setPanelVisualMode(mode: 'compact' | 'presented'): void {
  document.body.dataset.panelMode = mode;
  if (spotlightPanel) {
    spotlightPanel.dataset.mode = mode === 'presented' ? 'presented' : 'compact';
  }
}

function updatePinUi(): void {
  if (!pinPanelBtn) return;
  pinPanelBtn.setAttribute('aria-pressed', panelPinned ? 'true' : 'false');
  pinPanelBtn.title = panelPinned
    ? t('label.unpinPanel', 'Sabitlemeyi kaldır')
    : t('label.pinPanel', 'Paneli sabitle');
  spotlightPanel?.classList.toggle('is-pinned', panelPinned);
}

function bindChromeButton(
  btn: HTMLButtonElement | null,
  handler: () => void | Promise<void>
): void {
  if (!btn) return;
  let lastAt = 0;
  const run = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - lastAt < 250) return;
    lastAt = now;
    void handler();
  };
  btn.addEventListener('pointerup', run);
  btn.addEventListener('click', run);
}

function initSpotlightPanel(): void {
  bindChromeButton(dismissPanelBtn, async () => {
    await window.bridge.panelDismiss();
  });

  bindChromeButton(pinPanelBtn, async () => {
    panelPinned = !panelPinned;
    updatePinUi();
    await window.bridge.savePanelPinned(panelPinned);
  });

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape' && !panelPinned) {
      e.preventDefault();
      await window.bridge.panelDismiss();
    }
  });

  window.bridge.onPanelMode((mode) => {
    setPanelVisualMode(mode);
  });
}

function updateStatusDot(text: string): void {
  if (!statusDot) return;
  const lower = text.toLowerCase();
  const busy =
    text.includes('...') ||
    lower.includes('ing') ||
    lower.includes('yor') ||
    lower.includes('leniyor') ||
    lower.includes('anıyor');
  const error =
    lower.includes('hata') ||
    lower.includes('error') ||
    lower.includes('başarısız') ||
    lower.includes('failed');
  statusDot.className = 'status-dot';
  if (error) statusDot.classList.add('is-error');
  else if (busy) statusDot.classList.add('is-busy');
  else statusDot.classList.add('is-ready');
}

function showStatus(text: string): void {
  statusDirty = true;
  statusNode.textContent = text;
  updateStatusDot(text);
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
      qrCodeImage.classList.remove('hidden');
    } else {
      qrCodeImage.classList.add('hidden');
    }
  } catch (e) {
    console.error('QR Kod yükleme hatası:', e);
    qrCodeImage.classList.add('hidden');
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
      storageBar.classList.remove('is-warn', 'is-danger');
      if (pct > 90) storageBar.classList.add('is-danger');
      else if (pct > 75) storageBar.classList.add('is-warn');

      storageContainer.classList.remove('hidden');
    } else {
      storageContainer.classList.add('hidden');
    }
  } catch (e) {
    console.error('Storage query error:', e);
    storageContainer.classList.add('hidden');
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
  panelPinned = Boolean(state.panelPinned);
  updatePinUi();
  setPanelVisualMode('presented');
  updateAiProviderUi();
  // Only (re)apply the localized placeholders while no live runtime message is shown,
  // so switching language never wipes an AI reply / signed URL / OCR text.
  if (!statusDirty) {
    const readyText = state.selectionActive
      ? t('status.selectionActive', 'Seçim modu açık')
      : t('status.ready', 'Hazır');
    statusNode.textContent = readyText;
    updateStatusDot(readyText);
  }
  if (!responseDirty) {
    responseNode.textContent = t('response.placeholder', 'Yapay zeka yanıtı burada görünecek.');
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

initSpotlightPanel();
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

export {};
