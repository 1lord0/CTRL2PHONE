export interface SelectionAiActionPorts<Image> {
  isSelectionSessionCurrent(sessionId: number): boolean;
  isActionCurrent(actionSessionId: number): boolean;
  beginSelectionAction(sessionId: number): number | null;
  endSelectionAction(actionSessionId: number | null): void;

  writeImageToClipboard(image: Image): void;
  isApiProviderConfigured(): boolean;
  getPrompt(): string;

  hideSelectionOverlay(sessionId: number): void;
  resetSelectionSession(sessionId: number): void;
  setStatus(message: string): void;
  setResponse(message: string): void;
  activateTransientPill(): void;

  // Gemini API Provider
  analyzeImage(image: Image, prompt: string): Promise<string>;
  getAiProviderName(): string;

  // Gemini Web Window Controller
  openGeminiWindow(): Promise<any>;
  focusComposer(win: any, prompt: string): Promise<boolean>;
  sendPasteShortcut(win: any): void;

  // Image resolver
  resolveSelectionImage(): Promise<Image | null>;
}

export async function executeSelectionAiAction<Image>(
  sessionId: number,
  ports: SelectionAiActionPorts<Image>
): Promise<void> {
  const actionSessionId = ports.beginSelectionAction(sessionId);
  if (actionSessionId === null) return;

  const isCurrent = () =>
    ports.isSelectionSessionCurrent(sessionId) || ports.isActionCurrent(actionSessionId);

  try {
    const croppedImage = await ports.resolveSelectionImage();
    if (!croppedImage || !ports.isSelectionSessionCurrent(sessionId)) {
      return;
    }

    ports.hideSelectionOverlay(sessionId);
    ports.resetSelectionSession(sessionId);

    ports.writeImageToClipboard(croppedImage);

    if (ports.isApiProviderConfigured()) {
      ports.setStatus('Yapay zeka analiz ediyor...');
      ports.setResponse('Analiz ediliyor... (yanıt birazdan burada görünecek)');

      try {
        const text = await ports.analyzeImage(croppedImage, ports.getPrompt());
        if (!isCurrent()) return;

        ports.setResponse(text);
        ports.setStatus(`Yanıt alındı (${ports.getAiProviderName()})`);
        ports.activateTransientPill();
      } catch (error: any) {
        if (isCurrent()) {
          ports.setResponse(`Yapay zeka hatası: ${error.message}`);
          ports.setStatus('Yapay zeka isteği başarısız');
          ports.activateTransientPill();
        }
      }
      return;
    }

    const windowInstance = await ports.openGeminiWindow();
    if (!isCurrent()) return;

    const composerFocused = await ports.focusComposer(windowInstance, ports.getPrompt());
    ports.sendPasteShortcut(windowInstance);

    ports.setResponse(
      `Seçilen alan Gemini web'e kopyalandı. ${composerFocused ? 'Yapıştırma denendi.' : 'Yapıştırma kısayolu gönderildi.'}`
    );
    ports.setStatus("Seçilen görsel Gemini web'e yapıştırıldı");
    ports.activateTransientPill();
  } catch (error: any) {
    if (isCurrent()) {
      ports.setResponse(`Hata: ${error.message}`);
      ports.setStatus('Seçim veya yapıştırma sırasında hata');
      ports.hideSelectionOverlay(sessionId);
      ports.resetSelectionSession(sessionId);
    }
  } finally {
    ports.endSelectionAction(actionSessionId);
  }
}
