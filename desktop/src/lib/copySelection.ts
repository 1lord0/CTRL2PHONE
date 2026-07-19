export interface NativeImageLike {
  isEmpty: () => boolean;
}

export interface CopySelectionPorts<TImg extends NativeImageLike = NativeImageLike> {
  isSenderAuthorized: () => boolean;
  isSessionCurrent: () => boolean;
  getSelectionImage: () => Promise<TImg | null>;
  writeImageToClipboard: (image: TImg) => void;
  readImageFromClipboard: () => TImg;
  setStatus: (msg: string) => void;
  onSuccess?: () => void;
}

export interface CopySelectionResult {
  ok: boolean;
  error?: string;
}

export async function executeCopySelection<TImg extends NativeImageLike>(
  ports: CopySelectionPorts<TImg>
): Promise<CopySelectionResult> {
  if (!ports.isSenderAuthorized()) {
    return { ok: false, error: 'Unauthorized sender' };
  }
  if (!ports.isSessionCurrent()) {
    return { ok: false, error: 'Stale session' };
  }
  try {
    const image = await ports.getSelectionImage();
    if (!image || image.isEmpty()) {
      return { ok: false, error: 'Empty selection image' };
    }

    ports.writeImageToClipboard(image);

    // Verify write by reading it back
    const readImage = ports.readImageFromClipboard();
    if (!readImage || readImage.isEmpty()) {
      return { ok: false, error: 'Clipboard write verification failed' };
    }

    ports.setStatus('Seçim panoya kopyalandı');
    ports.onSuccess?.();
    return { ok: true };
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errMsg };
  }
}
