export interface SelectionPhoneActionPorts<Image, ContextType> {
  isSelectionSessionCurrent(sessionId: number): boolean;
  isActionCurrent(actionSessionId: number): boolean;
  beginSelectionAction(sessionId: number): number | null;
  endSelectionAction(actionSessionId: number | null): void;

  getSupabaseContext(): ContextType | null;
  isSupabaseContextCurrent(context: ContextType): boolean;

  hideSelectionOverlay(sessionId: number): void;
  resetSelectionSession(sessionId: number): void;
  setStatus(message: string): void;
  setResponse(message: string): void;
  activateTransientPill(): void;

  uploadToSupabase(context: ContextType, fileName: string, buffer: Buffer): Promise<{ error: any }>;
  createSignedUrl(context: ContextType, fileName: string): Promise<string | null>;

  generateRandomUUID(): string;

  resolveSelectionImage(): Promise<Image | null>;
  getImagePngBuffer(image: Image): Buffer;
}

export async function executeSelectionPhoneAction<Image, ContextType>(
  sessionId: number,
  ports: SelectionPhoneActionPorts<Image, ContextType>
): Promise<boolean> {
  const context = ports.getSupabaseContext();
  if (!context) {
    ports.setStatus('Supabase ayarları eksik! Lütfen ayarlardan doldurun.');
    ports.setResponse('Hata: Supabase URL veya Anon Key tanımlanmamış. Ayarları kontrol edin.');
    ports.hideSelectionOverlay(sessionId);
    ports.resetSelectionSession(sessionId);
    ports.activateTransientPill();
    return false;
  }

  const actionSessionId = ports.beginSelectionAction(sessionId);
  if (actionSessionId === null) return false;

  const isCurrent = () =>
    ports.isSelectionSessionCurrent(sessionId) || ports.isActionCurrent(actionSessionId);

  try {
    const croppedImage = await ports.resolveSelectionImage();
    if (!croppedImage || !ports.isSelectionSessionCurrent(sessionId)) {
      return false;
    }
    const pngBuffer = ports.getImagePngBuffer(croppedImage);

    ports.hideSelectionOverlay(sessionId);
    ports.resetSelectionSession(sessionId);
    ports.setStatus("Görsel Supabase'e yükleniyor...");

    const fileName = `screenshot_${ports.generateRandomUUID()}.png`;
    const { error } = await ports.uploadToSupabase(context, fileName, pngBuffer);

    if (!isCurrent()) {
      return false;
    }
    if (!ports.isSupabaseContextCurrent(context)) {
      throw new Error('Supabase ayarları yükleme sırasında değişti');
    }
    if (error) {
      throw new Error(`Supabase upload hatası: ${error.message || error}`);
    }

    let shareUrl: string | null = null;
    try {
      shareUrl = await ports.createSignedUrl(context, fileName);
    } catch {
      // ignore
    }

    if (!isCurrent()) {
      return false;
    }

    ports.setResponse(
      shareUrl
        ? `Supabase'e başarıyla yüklendi!\nGörsel Adresi (7 gün geçerli):\n${shareUrl}`
        : "Supabase'e başarıyla yüklendi! Telefon uygulamasından görüntüleyebilirsin."
    );
    ports.setStatus('Seçilen görsel telefona gönderildi (Supabase)');
    ports.activateTransientPill();
    return true;
  } catch (error: any) {
    if (isCurrent()) {
      ports.setResponse(`Hata: ${error.message}`);
      ports.setStatus('Supabase yükleme hatası');
      ports.hideSelectionOverlay(sessionId);
      ports.resetSelectionSession(sessionId);
      ports.activateTransientPill();
    }
    return false;
  } finally {
    ports.endSelectionAction(actionSessionId);
  }
}
