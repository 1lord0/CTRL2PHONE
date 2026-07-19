import {
  toAbsoluteRect as computeAbsoluteRect,
  clampRectToDisplay,
  computeCropRect,
} from '../lib/geometry';
import { SelectionSnapshot } from './selectionSessionController';

export interface ImageResolverPorts<Image> {
  isSessionCurrent(sessionId: number): boolean;
  getAnnotatedDataUrl(sessionId: number): Promise<string | null>;
  createImageFromDataURL(dataUrl: string): Image;
  isEmptyImage(image: Image): boolean;
}

export async function resolveSelectionImage<
  Image extends { crop(rect: any): Image; getSize(): { width: number; height: number } },
  Display extends {
    bounds: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
  },
>(
  snapshot: SelectionSnapshot<Image, Display>,
  ports: ImageResolverPorts<Image>
): Promise<Image | null> {
  const absoluteRect = computeAbsoluteRect(snapshot.rect, snapshot.display.bounds);
  const clampedRect = clampRectToDisplay(absoluteRect, snapshot.display.bounds);

  if (clampedRect.width <= 0 || clampedRect.height <= 0) {
    return null;
  }

  // Handle annotations if active
  if (snapshot.hasAnnotations) {
    try {
      const dataUrl = await ports.getAnnotatedDataUrl(snapshot.sessionId);
      if (!ports.isSessionCurrent(snapshot.sessionId)) return null;
      if (dataUrl && typeof dataUrl === 'string') {
        const img = ports.createImageFromDataURL(dataUrl);
        if (!ports.isEmptyImage(img)) {
          return img;
        }
      }
    } catch {
      // ignore annotation fallback, use normal crop
    }
  }

  if (!ports.isSessionCurrent(snapshot.sessionId)) return null;

  const relative = computeCropRect(
    clampedRect,
    snapshot.display.bounds,
    snapshot.image.getSize(),
    snapshot.display.scaleFactor
  );
  return snapshot.image.crop(relative);
}
