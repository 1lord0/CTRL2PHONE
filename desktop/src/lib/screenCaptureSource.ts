export interface RectSize {
  width: number;
  height: number;
}

export interface RectBounds extends RectSize {
  x: number;
  y: number;
}

export interface ExternalCaptureDisplay {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ExternalCaptureTarget {
  readonly bounds: RectBounds;
  readonly scaleFactor: number;
}

export interface CaptureSource<T = Electron.NativeImage> {
  id: string;
  name: string;
  display_id: string;
  thumbnail: T;
}

export function calculateThumbnailSize(bounds: RectSize, scaleFactor: number): RectSize {
  return {
    width: Math.max(1, Math.round(bounds.width * scaleFactor)),
    height: Math.max(1, Math.round(bounds.height * scaleFactor)),
  };
}

export function selectExternalCaptureDisplay<T extends ExternalCaptureDisplay>(
  displays: readonly T[],
  target: ExternalCaptureTarget
): T | null {
  const physicalBounds = {
    left: Math.round(target.bounds.x * target.scaleFactor),
    top: Math.round(target.bounds.y * target.scaleFactor),
    width: Math.round(target.bounds.width * target.scaleFactor),
    height: Math.round(target.bounds.height * target.scaleFactor),
  };
  const matches = displays.filter(
    (display) =>
      display.left === physicalBounds.left &&
      display.top === physicalBounds.top &&
      display.width === physicalBounds.width &&
      display.height === physicalBounds.height
  );
  return matches.length === 1 ? matches[0] : null;
}

export function selectCaptureSource<T extends { isEmpty: () => boolean; getSize?: () => RectSize }>(
  sources: CaptureSource<T>[],
  displayId: number
): CaptureSource<T> {
  const matching = sources.filter((s) => s.display_id === String(displayId));
  if (matching.length === 0) {
    throw new Error(`No capture source found matching display ID: ${displayId}`);
  }
  if (matching.length > 1) {
    throw new Error(`Multiple capture sources found matching display ID: ${displayId}`);
  }
  const source = matching[0];
  if (!source.thumbnail || source.thumbnail.isEmpty()) {
    throw new Error(`Capture source thumbnail is empty for display ID: ${displayId}`);
  }
  if (
    source.thumbnail.getSize &&
    (source.thumbnail.getSize().width === 0 || source.thumbnail.getSize().height === 0)
  ) {
    throw new Error(`Capture source thumbnail has zero size for display ID: ${displayId}`);
  }
  return source;
}
