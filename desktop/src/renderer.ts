// Keep this file a browser-global script. A top-level import makes TypeScript emit
// a CommonJS `exports` preamble, which crashes immediately in Chromium.
const mainBridge = (window as any).bridge as import('./types').MainBridgeAPI;
document.body.dataset.rendererCheckpoint = 'started';

function logUserAction(action: string, details?: Readonly<Record<string, unknown>>): void {
  try {
    mainBridge.logUserAction(action, details);
  } catch {
    // Diagnostics are best-effort and must never interrupt a user action.
  }
}

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
const actionWebhookUrlInput = document.getElementById('actionWebhookUrl') as HTMLInputElement;
const actionWebhookSecretInput = document.getElementById('actionWebhookSecret') as HTMLInputElement;
const uiLanguageInput = document.getElementById('uiLanguage') as HTMLSelectElement;
const pillVisibilityInput = document.getElementById('pillVisibility') as HTMLSelectElement;
const statusNode = document.getElementById('status') as HTMLElement;
const statusDot = document.getElementById('statusDot') as HTMLElement;
const responseNode = document.getElementById('response') as HTMLElement;
const spotlightPanel = document.getElementById('spotlightPanel') as HTMLElement;
const dismissPanelBtn = document.getElementById('dismissPanel') as HTMLButtonElement;
const pinPanelBtn = document.getElementById('pinPanel') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('saveSettings') as HTMLButtonElement;
const qrCodeImage = document.getElementById('qrCodeImage') as HTMLImageElement;
const qrPairingStatus = document.getElementById('qrPairingStatus') as HTMLElement;
const actionResultCard = document.getElementById('actionResultCard') as HTMLElement;
const actionResultTitle = document.getElementById('actionResultTitle') as HTMLElement;
const actionResultStatus = document.getElementById('actionResultStatus') as HTMLElement;
const actionProgressTrack = document.getElementById('actionProgressTrack') as HTMLElement;
const actionProgressBar = document.getElementById('actionProgressBar') as HTMLElement;
const actionResultProgress = document.getElementById('actionResultProgress') as HTMLElement;
const actionResultConfidence = document.getElementById('actionResultConfidence') as HTMLElement;
const actionResultSummary = document.getElementById('actionResultSummary') as HTMLElement;
const actionSourcesBlock = document.getElementById('actionSourcesBlock') as HTMLElement;
const actionSources = document.getElementById('actionSources') as HTMLUListElement;
const actionResultDetails = document.getElementById('actionResultDetails') as HTMLDetailsElement;
const actionResultJson = document.getElementById('actionResultJson') as HTMLElement;
const sendActionToPhoneBtn = document.getElementById('sendActionToPhone') as HTMLButtonElement;
const actionPhoneNote = document.getElementById('actionPhoneNote') as HTMLElement;

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
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key && currentI18n[key] != null) {
      el.title = currentI18n[key];
      if (el.hasAttribute('aria-label')) {
        el.setAttribute('aria-label', currentI18n[key]);
      }
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
let storageUsageRequestId = 0;
let settingsSaveInFlight = false;
let panelPinned = false;
let qrCodeRequestId = 0;
let latestActionTask: import('./types').ActionTaskSnapshot | null = null;
const supabaseDraft = {
  url: '',
  key: '',
  bucket: '',
};
let supabaseDraftDirty = false;

function bindSupabaseDraft(input: HTMLInputElement, field: keyof typeof supabaseDraft): void {
  const capture = () => {
    supabaseDraft[field] = input.value;
    supabaseDraftDirty = true;
  };
  input.addEventListener('input', capture);
  input.addEventListener('change', capture);
  input.addEventListener('paste', (event: ClipboardEvent) => {
    const pastedText = event.clipboardData?.getData('text') ?? '';
    queueMicrotask(() => {
      // Chromium can paint restored/autofilled text before exposing it through value.
      // Preserve the actual paste payload as a fallback for that edge case.
      supabaseDraft[field] = input.value || pastedText;
      supabaseDraftDirty = true;
    });
  });
}

bindSupabaseDraft(supabaseUrlInput, 'url');
bindSupabaseDraft(supabaseKeyInput, 'key');
bindSupabaseDraft(supabaseBucketInput, 'bucket');
document.body.dataset.rendererCheckpoint = 'supabase-draft-bound';

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
  const run = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    void Promise.resolve(handler()).catch((error) => {
      console.error('Panel button action failed:', error);
    });
  };
  btn.addEventListener('click', run);
}

function initSpotlightPanel(): void {
  bindChromeButton(dismissPanelBtn, async () => {
    const result = await mainBridge.quitApp();
    if (!result?.ok) {
      showStatus(result?.error || t('status.genericError', 'Uygulama kapatılamadı.'));
    }
  });

  bindChromeButton(pinPanelBtn, async () => {
    panelPinned = !panelPinned;
    updatePinUi();
    await mainBridge.savePanelPinned(panelPinned);
  });

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape' && !panelPinned) {
      e.preventDefault();
      await mainBridge.panelDismiss();
    }
  });

  mainBridge.onPanelMode((mode) => {
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

function actionStatusText(status: import('./types').ActionTaskWorkflowStatus): string {
  const labels: Record<import('./types').ActionTaskWorkflowStatus, [string, string]> = {
    queued: ['action.status.queued', 'Queued'],
    analyzing: ['action.status.analyzing', 'Analyzing'],
    researching: ['action.status.researching', 'Researching'],
    completed: ['action.status.completed', 'Completed'],
    failed: ['action.status.failed', 'Failed'],
    cancelled: ['action.status.cancelled', 'Cancelled'],
  };
  const [key, fallback] = labels[status];
  return t(key, fallback);
}

function renderActionTask(task: import('./types').ActionTaskSnapshot): void {
  latestActionTask = task;
  actionResultCard.classList.remove('hidden');
  actionResultCard.dataset.status = task.workflowStatus;
  actionResultTitle.textContent = task.title;
  actionResultStatus.textContent = actionStatusText(task.workflowStatus);
  actionResultStatus.className = `action-status-badge is-${task.workflowStatus}`;
  actionProgressBar.style.width = `${Math.max(0, Math.min(100, task.progress))}%`;
  actionProgressTrack.setAttribute('aria-valuenow', String(task.progress));
  actionResultProgress.textContent = `${task.progress}%`;
  actionResultConfidence.textContent =
    task.confidence === null
      ? ''
      : `${t('label.actionConfidence', 'Confidence')}: ${Math.round(task.confidence * 100)}%`;

  const failureText = task.errorMessage || task.errorCode;
  actionResultSummary.textContent =
    failureText ||
    task.summary ||
    t('action.summary.waiting', 'The live result will appear here as the workflow progresses.');

  actionSources.replaceChildren();
  for (const source of task.sources) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    const url = document.createElement('span');
    title.textContent = source.title;
    url.textContent = source.url;
    item.append(title, url);
    actionSources.append(item);
  }
  actionSourcesBlock.classList.toggle('hidden', task.sources.length === 0);

  const hasResult = Object.keys(task.resultJson).length > 0;
  actionResultJson.textContent = hasResult ? JSON.stringify(task.resultJson, null, 2) : '';
  actionResultDetails.classList.toggle('hidden', !hasResult);

  // Manage manual "Send to Phone" button and hint text
  if (task.workflowStatus === 'completed') {
    if (task.sentToPhone) {
      sendActionToPhoneBtn.classList.add('hidden');
      actionPhoneNote.classList.remove('hidden');
    } else {
      sendActionToPhoneBtn.classList.remove('hidden');
      sendActionToPhoneBtn.disabled = false;
      sendActionToPhoneBtn.textContent = t('btn.sendActionToPhone', 'Telefona Gönder');
      actionPhoneNote.classList.add('hidden');
    }
  } else {
    sendActionToPhoneBtn.classList.add('hidden');
    actionPhoneNote.classList.add('hidden');
  }
}

async function updateQrCode(): Promise<void> {
  const requestId = ++qrCodeRequestId;
  try {
    const result = await mainBridge.generateQr();
    if (requestId !== qrCodeRequestId) return;
    if (result?.ok && result.dataUrl) {
      qrCodeImage.src = result.dataUrl;
      qrCodeImage.classList.remove('hidden');
      qrCodeImage.dataset.actionPairing = result.actionPairingIncluded ? 'included' : 'legacy';
      qrPairingStatus.classList.remove('hidden', 'is-warning', 'is-ready');
      qrPairingStatus.classList.add(result.actionPairingIncluded ? 'is-ready' : 'is-warning');
      qrPairingStatus.textContent = result.actionPairingIncluded
        ? t('status.actionPairingReady', 'Photo and Tasks pairing is included in this QR.')
        : t(
            'status.actionPairingMissing',
            'Photo pairing is ready. Run Secure Setup SQL to enable Tasks pairing.'
          );
      if (result.warning) {
        console.warn('Action pairing was not included in the QR payload:', result.warning);
      }
    } else {
      qrCodeImage.classList.add('hidden');
      qrPairingStatus.classList.add('hidden');
    }
  } catch (e) {
    if (requestId !== qrCodeRequestId) return;
    console.error('QR Kod yükleme hatası:', e);
    qrCodeImage.classList.add('hidden');
    qrPairingStatus.classList.add('hidden');
  }
}

async function updateStorageUsage(): Promise<void> {
  const requestId = ++storageUsageRequestId;
  try {
    const result = await mainBridge.getStorageUsage();
    if (requestId !== storageUsageRequestId) return;
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
    if (requestId !== storageUsageRequestId) return;
    console.error('Storage query error:', e);
    storageContainer.classList.add('hidden');
  }
}

function loadSettings(state: any): void {
  applyI18n(state.i18n || {});
  promptInput.value = state.prompt || '';
  // Do not let a late app-ready/language refresh overwrite credentials the user
  // has already typed or pasted while the IPC request was in flight.
  if (!supabaseDraftDirty) {
    supabaseUrlInput.value = state.supabaseUrl || '';
    supabaseKeyInput.value = state.supabaseKey || '';
    supabaseBucketInput.value = state.supabaseBucket || 'screenshots';
    supabaseDraft.url = supabaseUrlInput.value;
    supabaseDraft.key = supabaseKeyInput.value;
    supabaseDraft.bucket = supabaseBucketInput.value;
  }
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
  if (actionWebhookUrlInput) {
    actionWebhookUrlInput.value =
      state.actionWebhookUrl || 'http://127.0.0.1:5678/webhook/ctrl2phone-action';
  }
  if (actionWebhookSecretInput) {
    actionWebhookSecretInput.value = state.actionWebhookSecret || '';
  }
  if (uiLanguageInput) {
    uiLanguageInput.value = state.language || 'system';
  }
  panelPinned = Boolean(state.panelPinned);
  if (pillVisibilityInput) {
    pillVisibilityInput.value = state.pillVisibility || 'always';
  }
  updatePinUi();
  setPanelVisualMode('presented');
  updateAiProviderUi();
  if (latestActionTask) renderActionTask(latestActionTask);
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
  await mainBridge.saveSettings({
    language: (uiLanguageInput.value as 'system' | 'en' | 'tr') || 'system',
  });
  const state = await mainBridge.ready();
  loadSettings(state);
});

document.getElementById('quitApp')?.addEventListener('click', async () => {
  await mainBridge.quitApp();
});

initSpotlightPanel();
document.body.dataset.rendererCheckpoint = 'panel-bound';
mainBridge.ready().then((state) => {
  loadSettings(state);
});

mainBridge.onStatus((message) => {
  showStatus(message);
});

mainBridge.onResponse((message) => {
  showResponse(message);
  // Trigger storage update whenever we finish sending something
  updateStorageUsage();
});

mainBridge.onActionTaskUpdated((task) => {
  renderActionTask(task);
});

mainBridge.onOverlayMessage((message) => {
  const overlayText = document.getElementById('overlayText');
  if (overlayText) {
    overlayText.textContent = message;
  }
});
document.body.dataset.rendererCheckpoint = 'bridge-events-bound';

async function saveSettingsFromForm(): Promise<void> {
  if (settingsSaveInFlight) return;

  const supabaseUrl = (supabaseUrlInput.value || supabaseDraft.url).trim();
  const supabaseKey = (supabaseKeyInput.value || supabaseDraft.key).trim();
  const supabaseBucket =
    (supabaseBucketInput.value || supabaseDraft.bucket).trim() || 'screenshots';
  const autoCopyFromPhone = autoCopyFromPhoneInput ? autoCopyFromPhoneInput.checked : false;
  if (autoCopyFromPhone && (!supabaseUrl || !supabaseKey)) {
    showStatus('Supabase URL ve Anon Key alanlarını birlikte doldurun.');
    (!supabaseUrl ? supabaseUrlInput : supabaseKeyInput).focus();
    return;
  }

  const payload = {
    prompt: promptInput.value.trim(),
    supabaseUrl,
    supabaseKey,
    supabaseBucket,
    autoCopyFromPhone,
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
    actionWebhookUrl:
      actionWebhookUrlInput?.value.trim() || 'http://127.0.0.1:5678/webhook/ctrl2phone-action',
    actionWebhookSecret: actionWebhookSecretInput?.value.trim() ?? '',
    language: (uiLanguageInput?.value as 'system' | 'en' | 'tr') || 'system',
    pillVisibility:
      (pillVisibilityInput?.value as 'always' | 'background' | 'capture-only') || 'always',
  };

  settingsSaveInFlight = true;
  saveSettingsBtn.disabled = true;
  try {
    const result = await mainBridge.saveSettings(payload);

    if (result?.ok) {
      supabaseUrlInput.value = supabaseUrl;
      supabaseKeyInput.value = supabaseKey;
      supabaseBucketInput.value = supabaseBucket;
      supabaseDraft.url = supabaseUrl;
      supabaseDraft.key = supabaseKey;
      supabaseDraft.bucket = supabaseBucket;
      supabaseDraftDirty = false;
      showStatus(t('status.settingsSaved', 'Ayarlar kaydedildi'));
      updateQrCode();
      updateStorageUsage();
    } else {
      showStatus(result?.error || t('status.genericError', 'Ayarlar kaydedilemedi.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showStatus(`${t('status.genericError', 'Ayarlar kaydedilemedi.')}: ${message}`);
  } finally {
    settingsSaveInFlight = false;
    saveSettingsBtn.disabled = false;
  }
}

saveSettingsBtn.addEventListener('click', () => {
  void saveSettingsFromForm();
});
saveSettingsBtn.dataset.handlerBound = 'true';

sendActionToPhoneBtn.addEventListener('click', async () => {
  if (!latestActionTask) return;
  sendActionToPhoneBtn.disabled = true;
  sendActionToPhoneBtn.textContent = t('btn.sending', 'Gönderiliyor...');
  try {
    const result = await mainBridge.sendActionToPhone(latestActionTask.id);
    if (result && result.ok) {
      sendActionToPhoneBtn.classList.add('hidden');
      actionPhoneNote.classList.remove('hidden');
      // Update local cache state
      if (latestActionTask) {
        latestActionTask = {
          ...latestActionTask,
          sentToPhone: true,
        };
      }
    } else {
      sendActionToPhoneBtn.disabled = false;
      sendActionToPhoneBtn.textContent = t('btn.sendActionToPhone', 'Telefona Gönder');
      showStatus(result?.error || t('status.sendToPhoneFailed', 'Telefona gönderilemedi.'));
    }
  } catch (err: any) {
    sendActionToPhoneBtn.disabled = false;
    sendActionToPhoneBtn.textContent = t('btn.sendActionToPhone', 'Telefona Gönder');
    showStatus(`${t('status.sendToPhoneFailed', 'Telefona gönderilemedi.')}: ${err.message}`);
  }
});

document.body.dataset.rendererCheckpoint = 'save-bound';

const diagnosticSafeEnumFields = new Set([
  'aiProvider',
  'uiLanguage',
  'pillVisibility',
  'hotkeyVk',
  'doublePressMs',
]);

document.addEventListener(
  'click',
  (event) => {
    const control = (event.target as Element | null)?.closest<HTMLElement>(
      'button, [role="button"]'
    );
    if (!control) return;
    logUserAction('ui.click', {
      controlId: control.id || control.dataset.i18n || control.tagName.toLowerCase(),
      panelMode: document.body.dataset.panelMode || 'unknown',
    });
  },
  true
);

document.addEventListener(
  'change',
  (event) => {
    const control = event.target;
    if (
      !(
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement
      )
    ) {
      return;
    }
    const details: Record<string, unknown> = {
      controlId: control.id || control.name || control.tagName.toLowerCase(),
      inputType: control instanceof HTMLInputElement ? control.type : control.tagName.toLowerCase(),
      hasValue: control.value.length > 0,
      valueLength: control.value.length,
    };
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      details.checked = control.checked;
    }
    if (diagnosticSafeEnumFields.has(control.id)) {
      details.selectedValue = control.value;
    }
    logUserAction('ui.field_changed', details);
  },
  true
);

document.addEventListener(
  'paste',
  (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) return;
    logUserAction('ui.paste', {
      controlId: control.id || control.name || control.tagName.toLowerCase(),
      pastedLength: event.clipboardData?.getData('text').length ?? 0,
    });
  },
  true
);

document.getElementById('setupRls')?.addEventListener('click', async () => {
  showStatus(t('status.rlsCopying', 'RLS SQL panoya kopyalanıyor...'));
  try {
    const result = await mainBridge.setupRls();
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
    const result = await mainBridge.purgeStorage();
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
    const result = await mainBridge.sendClipboard();
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

document.body.dataset.rendererReady = 'true';
document.body.dataset.rendererCheckpoint = 'ready';

// NOT: Bu dosya bilinçli olarak global script'tir (overlay.ts gibi) — `export {}`
// eklemeyin! Modül yapmak tsc'ye CommonJS önsözü (`exports` referansı) yazdırır ve
// script tarayıcıda "exports is not defined" ile ilk satırda ölür: hiçbir buton
// çalışmaz. Üst düzey isimler pill-renderer.ts/overlay.ts ile çakışmamalıdır.
