export interface SelectionOcrActionPorts<Image> {
  isSelectionSessionCurrent(sessionId: number): boolean;
  isActionCurrent(actionSessionId: number): boolean;
  beginSelectionAction(sessionId: number): number | null;
  endSelectionAction(actionSessionId: number | null): void;

  isOcrInFlight(): boolean;
  setOcrInFlight(active: boolean): void;

  hideSelectionOverlay(sessionId: number): void;
  resetSelectionSession(sessionId: number): void;
  setStatus(message: string): void;
  setResponse(message: string): void;
  activateTransientPill(): void;

  guardLocalClipboard(timeoutMs: number): void;
  writeTextToClipboardReliable(text: string): Promise<boolean>;

  extractTextFromImage(pngBuffer: Buffer): Promise<{ text: string; source: string }>;
  getProviderName(): string;

  resolveSelectionImage(): Promise<Image | null>;
  getImagePngBuffer(image: Image): Buffer;
}

export async function executeSelectionOcrAction<Image>(
  sessionId: number,
  ports: SelectionOcrActionPorts<Image>
): Promise<void> {
  if (ports.isOcrInFlight()) {
    ports.setStatus('OCR zaten çalışıyor, lütfen bekleyin...');
    return;
  }

  const actionSessionId = ports.beginSelectionAction(sessionId);
  if (actionSessionId === null) return;

  ports.setOcrInFlight(true);

  const isCurrent = () =>
    ports.isSelectionSessionCurrent(sessionId) || ports.isActionCurrent(actionSessionId);

  try {
    const croppedImage = await ports.resolveSelectionImage();
    if (!croppedImage || !ports.isSelectionSessionCurrent(sessionId)) {
      return;
    }
    const pngBuffer = ports.getImagePngBuffer(croppedImage);

    ports.hideSelectionOverlay(sessionId);
    ports.resetSelectionSession(sessionId);
    ports.guardLocalClipboard(45000);
    ports.setStatus('Metin okunuyor (OCR)...');
    ports.setResponse('OCR çalışıyor... (bitince otomatik panoya kopyalanacak)');

    const { text, source } = await ports.extractTextFromImage(pngBuffer);
    if (!isCurrent()) {
      return;
    }

    if (!text.trim()) {
      ports.setResponse('Seçilen alanda okunabilir metin bulunamadı.');
      ports.setStatus('OCR tamamlandı - metin yok');
      ports.activateTransientPill();
      return;
    }

    const copied = await ports.writeTextToClipboardReliable(text);
    const preview = text.length > 500 ? text.substring(0, 500) + '...' : text;
    ports.setResponse(preview);

    if (copied) {
      ports.setStatus(
        source === 'windows'
          ? 'Metin panoya kopyalandı (Windows OCR) - Ctrl+V ile yapıştır'
          : `Metin panoya kopyalandı (${ports.getProviderName()} OCR) - Ctrl+V ile yapıştır`
      );
    } else {
      ports.setStatus(
        'OCR metni üretildi ama panoya yazılamadı - metni response alanından kopyalayın'
      );
      ports.setResponse(
        `${preview}\n\n⚠️ Panoya otomatik kopyalanamadı. Yukarıdaki metni elle seçip kopyalayın.`
      );
    }
    ports.activateTransientPill();
  } catch (error: any) {
    if (isCurrent()) {
      ports.setResponse(`OCR hatası: ${error.message}`);
      ports.setStatus('Metin okunamadı');
      ports.hideSelectionOverlay(sessionId);
      ports.resetSelectionSession(sessionId);
      ports.activateTransientPill();
    }
  } finally {
    ports.setOcrInFlight(false);
    ports.endSelectionAction(actionSessionId);
  }
}
