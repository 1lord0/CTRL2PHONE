import { resolveSelectionImage, type ImageResolverPorts } from '../src/main/selectionImageResolver';
import { SelectionSnapshot } from '../src/main/selectionSessionController';

class MockImage {
  cropResult: MockImage | null = null;
  size = { width: 1920, height: 1080 };
  
  constructor(public id: string) {}

  getSize() {
    return this.size;
  }

  crop() {
    return this.cropResult || new MockImage('cropped_' + this.id);
  }
}

describe('SelectionImageResolver', () => {
  let isCurrent = true;
  let annotatedUrl: string | null = null;
  let isImageEmpty = false;

  const ports: ImageResolverPorts<MockImage> = {
    isSessionCurrent: () => isCurrent,
    getAnnotatedDataUrl: async () => annotatedUrl,
    createImageFromDataURL: (url) => new MockImage('composite_' + url),
    isEmptyImage: () => isImageEmpty,
  };

  beforeEach(() => {
    isCurrent = true;
    annotatedUrl = null;
    isImageEmpty = false;
  });

  it('performs normal crop when annotations are disabled', async () => {
    const snapshot: SelectionSnapshot<MockImage, any> = {
      sessionId: 1,
      image: new MockImage('screen'),
      rect: { x: 10, y: 10, width: 100, height: 100 },
      display: {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
      },
      hasAnnotations: false,
    };

    const result = await resolveSelectionImage(snapshot, ports);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('cropped_screen');
  });

  it('returns annotated composite image if annotations are enabled and valid', async () => {
    annotatedUrl = 'data:image/png;base64,abc';
    const snapshot: SelectionSnapshot<MockImage, any> = {
      sessionId: 1,
      image: new MockImage('screen'),
      rect: { x: 10, y: 10, width: 100, height: 100 },
      display: {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
      },
      hasAnnotations: true,
    };

    const result = await resolveSelectionImage(snapshot, ports);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('composite_data:image/png;base64,abc');
  });

  it('falls back to normal crop if annotated composite load fails or is empty', async () => {
    annotatedUrl = 'data:image/png;base64,abc';
    isImageEmpty = true; // Composite resolves to empty image

    const snapshot: SelectionSnapshot<MockImage, any> = {
      sessionId: 1,
      image: new MockImage('screen'),
      rect: { x: 10, y: 10, width: 100, height: 100 },
      display: {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
      },
      hasAnnotations: true,
    };

    const result = await resolveSelectionImage(snapshot, ports);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('cropped_screen');
  });
});
