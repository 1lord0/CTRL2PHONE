export interface SelectionWorkflowActionPorts<Image> {
  isSelectionSessionCurrent(sessionId: number): boolean;
  isActionCurrent(actionSessionId: number): boolean;
  beginSelectionAction(sessionId: number): number | null;
  endSelectionAction(actionSessionId: number): void;
  resolveSelectionImage(): Promise<Image | null>;
  getImagePngBuffer(image: Image): Buffer;
  analyzeIntent(
    pngBuffer: Buffer
  ): Promise<import('../lib/actionIntentAnalyzer').ActionIntentAnalysis>;
  submitAction(input: {
    selectionSessionId: number;
    pngBuffer: Buffer;
    intentAnalysis: import('../lib/actionIntentAnalyzer').ActionIntentAnalysis;
    isCurrent(): boolean;
  }): Promise<{ taskId: string }>;
  hideSelectionOverlay(sessionId: number): void;
  resetSelectionSession(sessionId: number): void;
  setStatus(message: string): void;
  setResponse(message: string): void;
  activateTransientPill(): void;
  reportError?(stage: string, error: unknown, details?: Readonly<Record<string, unknown>>): void;
  reportEvent?(stage: string, details?: Readonly<Record<string, unknown>>): void;
}

export function formatActionErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (rawMessage.includes('action_gemini_api_key_missing')) {
    return 'Gemini API anahtarı eksik. Lütfen Ayarlar sayfasından Gemini API anahtarınızı girin.';
  }
  if (
    rawMessage.includes('fetch failed') ||
    rawMessage.includes('action_webhook_http_') ||
    rawMessage.includes('ECONNREFUSED')
  ) {
    return 'n8n sunucusuna erişilemedi. Lütfen n8n servisinin çalıştığından emin olun.';
  }
  if (rawMessage.includes('action_input_upload_failed')) {
    return 'Görsel Supabase Storage sunucusuna yüklenemedi. Supabase izinlerini kontrol edin.';
  }
  if (rawMessage.includes('action_task_enqueue_failed')) {
    return 'Action görevi veritabanına eklenemedi. Supabase SQL fonksiyonlarını kontrol edin.';
  }
  if (
    rawMessage.includes('action_supabase_settings_missing') ||
    rawMessage.includes('action_supabase_url_invalid')
  ) {
    return 'Supabase ayarları eksik veya geçersiz. Lütfen Ayarlar sayfasından Supabase ayarlarını kontrol edin.';
  }
  if (
    rawMessage.includes('action_webhook_secret_missing_or_too_short') ||
    rawMessage.includes('action_webhook_url_invalid') ||
    rawMessage.includes('action_webhook_url_insecure')
  ) {
    return 'n8n Webhook yapılandırması geçersiz. Lütfen Ayarlar sayfasından Webhook ayarlarını kontrol edin.';
  }
  return rawMessage;
}

export async function executeSelectionWorkflowAction<Image>(
  sessionId: number,
  ports: SelectionWorkflowActionPorts<Image>
): Promise<boolean> {
  const actionSessionId = ports.beginSelectionAction(sessionId);
  if (actionSessionId === null) return false;
  const isCurrent = () =>
    ports.isSelectionSessionCurrent(sessionId) || ports.isActionCurrent(actionSessionId);
  ports.reportEvent?.('selection_action_started', { sessionId, actionSessionId });

  try {
    const image = await ports.resolveSelectionImage();
    if (!image || !ports.isSelectionSessionCurrent(sessionId)) return false;
    const pngBuffer = ports.getImagePngBuffer(image);
    ports.reportEvent?.('selection_image_resolved', {
      sessionId,
      byteLength: pngBuffer.length,
    });

    ports.hideSelectionOverlay(sessionId);
    ports.resetSelectionSession(sessionId);
    ports.setStatus('Gemini görsel niyetini analiz ediyor...');

    const intentAnalysis = await ports.analyzeIntent(pngBuffer);
    if (!isCurrent()) return false;
    ports.reportEvent?.('selection_intent_analyzed', {
      sessionId,
      intentType: intentAnalysis.intentType,
      confidence: intentAnalysis.confidence,
      searchQueryCount: intentAnalysis.searchQueries.length,
      visibleTextCount: intentAnalysis.visibleText.length,
    });
    ports.setStatus('Action görevi hazırlanıyor...');

    const result = await ports.submitAction({
      selectionSessionId: sessionId,
      pngBuffer,
      intentAnalysis,
      isCurrent,
    });
    if (!isCurrent()) return false;

    ports.reportEvent?.('selection_task_submitted', {
      sessionId,
      taskId: result.taskId,
    });

    ports.setStatus('AI action görevi n8n akışına gönderildi');
    ports.setResponse(`Action görevi oluşturuldu. Görev kimliği: ${result.taskId}`);
    ports.activateTransientPill();
    return true;
  } catch (error: unknown) {
    ports.reportError?.('selection_action_failed', error, { sessionId });
    if (isCurrent()) {
      const friendlyMessage = formatActionErrorMessage(error);
      ports.setStatus('AI action görevi başlatılamadı');
      ports.setResponse(`Action hatası: ${friendlyMessage}`);
      ports.hideSelectionOverlay(sessionId);
      ports.resetSelectionSession(sessionId);
      ports.activateTransientPill();
    }
    return false;
  } finally {
    ports.endSelectionAction(actionSessionId);
  }
}
