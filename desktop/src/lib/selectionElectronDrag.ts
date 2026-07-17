export interface SelectionDragAsset<TIcon> {
  file: string;
  icon: TIcon;
}

export interface SelectionElectronDragPorts<TBounds, TIcon> {
  getAsset: () => SelectionDragAsset<TIcon> | null;
  getOverlayBounds: () => TBounds;
  prepareOverlay: () => void;
  startDrag: (asset: SelectionDragAsset<TIcon>) => void;
  restoreOverlayBounds: (bounds: TBounds) => void;
  finishSelection: (filePath: string) => void;
  reportError: (message: string) => void;
}

export interface SelectionElectronDragResult {
  ok: boolean;
  error?: string;
}

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export function calculateDragPreviewSize(source: ImageSize, maximum: ImageSize): ImageSize {
  const scale = Math.min(1, maximum.width / source.width, maximum.height / source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export function executeSelectionElectronDrag<TBounds, TIcon>(
  ports: SelectionElectronDragPorts<TBounds, TIcon>
): SelectionElectronDragResult {
  const asset = ports.getAsset();
  if (!asset) {
    return { ok: false, error: 'drag asset is not ready' };
  }

  const bounds = ports.getOverlayBounds();
  ports.prepareOverlay();
  try {
    ports.startDrag(asset);
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    ports.reportError(message);
    return { ok: false, error: message };
  } finally {
    ports.restoreOverlayBounds(bounds);
    ports.finishSelection(asset.file);
  }
}
