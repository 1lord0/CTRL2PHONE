import {
  calculateThumbnailSize,
  createExternalCaptureDisplayCache,
  selectCaptureSource,
  selectExternalCaptureDisplay,
  CaptureSource,
} from '../src/lib/screenCaptureSource';

describe('external capture display cache', () => {
  const target = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
  };

  it('reuses a successful display listing across capture sessions', async () => {
    // Given a stable external display configuration
    const loadDisplays = jest.fn(async () => [
      { id: '\\\\.\\DISPLAY1', left: 0, top: 0, width: 1920, height: 1080 },
    ]);
    const cache = createExternalCaptureDisplayCache(loadDisplays);

    // When the same active display is resolved twice
    await cache.resolve(target);
    await cache.resolve(target);

    // Then the expensive external display listing runs once
    expect(loadDisplays).toHaveBeenCalledTimes(1);
  });

  it('refreshes once when cached displays no longer match the active display', async () => {
    // Given a cached configuration that becomes stale
    const loadDisplays = jest
      .fn<Promise<readonly ExternalCaptureDisplay[]>, []>()
      .mockResolvedValueOnce([
        { id: '\\\\.\\DISPLAY2', left: 1920, top: 0, width: 1920, height: 1080 },
      ])
      .mockResolvedValueOnce([
        { id: '\\\\.\\DISPLAY1', left: 0, top: 0, width: 1920, height: 1080 },
      ]);
    const cache = createExternalCaptureDisplayCache(loadDisplays);

    // When the active display cannot be found in the cached listing
    const display = await cache.resolve(target);

    // Then one fresh listing is attempted before returning the correct display
    expect(loadDisplays).toHaveBeenCalledTimes(2);
    expect(display?.id).toBe('\\\\.\\DISPLAY1');
  });

  it('reloads displays after explicit invalidation', async () => {
    // Given a previously resolved display listing
    const loadDisplays = jest.fn(async () => [
      { id: '\\\\.\\DISPLAY1', left: 0, top: 0, width: 1920, height: 1080 },
    ]);
    const cache = createExternalCaptureDisplayCache(loadDisplays);
    await cache.resolve(target);

    // When Electron reports a display topology change
    cache.invalidate();
    await cache.resolve(target);

    // Then the next capture reloads the external display mapping
    expect(loadDisplays).toHaveBeenCalledTimes(2);
  });
});

describe('calculateThumbnailSize', () => {
  it('calculates size correctly for 100% scale factor', () => {
    expect(calculateThumbnailSize({ width: 1920, height: 1080 }, 1.0)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('calculates size correctly for 125% scale factor', () => {
    expect(calculateThumbnailSize({ width: 1920, height: 1080 }, 1.25)).toEqual({
      width: 2400,
      height: 1350,
    });
  });

  it('calculates size correctly for 150% scale factor', () => {
    expect(calculateThumbnailSize({ width: 1920, height: 1080 }, 1.5)).toEqual({
      width: 2880,
      height: 1620,
    });
  });

  it('ensures width and height are at least 1', () => {
    expect(calculateThumbnailSize({ width: 0, height: 0 }, 1.0)).toEqual({
      width: 1,
      height: 1,
    });
  });
});

describe('selectExternalCaptureDisplay', () => {
  const displays = [
    { id: '\\\\.\\DISPLAY1', left: 0, top: 0, width: 1920, height: 1080 },
    { id: '\\\\.\\DISPLAY2', left: 1920, top: 0, width: 1600, height: 900 },
  ];

  it('maps Electron DIP bounds to the matching physical display', () => {
    expect(
      selectExternalCaptureDisplay(displays, {
        bounds: { x: 1536, y: 0, width: 1280, height: 720 },
        scaleFactor: 1.25,
      })
    ).toBe(displays[1]);
  });

  it('returns null instead of silently capturing the wrong display', () => {
    expect(
      selectExternalCaptureDisplay(displays, {
        bounds: { x: -1280, y: 0, width: 1280, height: 720 },
        scaleFactor: 1,
      })
    ).toBeNull();
  });
});

interface MockThumbnail {
  isEmpty: () => boolean;
  getSize: () => { width: number; height: number };
}

describe('selectCaptureSource', () => {
  const createFakeSource = (displayId: string, isEmpty = false, width = 100, height = 100): CaptureSource<MockThumbnail> => ({
    id: `screen:${displayId}`,
    name: `Screen ${displayId}`,
    display_id: displayId,
    thumbnail: {
      isEmpty: () => isEmpty,
      getSize: () => ({ width, height }),
    },
  });

  it('performs exact string display_id match', () => {
    const s1 = createFakeSource('1');
    const s2 = createFakeSource('2');
    const result = selectCaptureSource([s1, s2], 2);
    expect(result).toBe(s2);
  });

  it('correctly selects even if source order changes', () => {
    const s1 = createFakeSource('2');
    const s2 = createFakeSource('1');
    const result = selectCaptureSource([s1, s2], 1);
    expect(result).toBe(s2);
  });

  it('works with negative or secondary display ID values', () => {
    const s1 = createFakeSource('-4219');
    const result = selectCaptureSource([s1], -4219);
    expect(result).toBe(s1);
  });

  it('throws error when no matching display ID exists (no fallback to first)', () => {
    const s1 = createFakeSource('1');
    const s2 = createFakeSource('2');
    expect(() => selectCaptureSource([s1, s2], 3)).toThrow(
      'No capture source found matching display ID: 3'
    );
  });

  it('throws error when multiple sources match the same display ID', () => {
    const s1 = createFakeSource('1');
    const s2 = createFakeSource('1');
    expect(() => selectCaptureSource([s1, s2], 1)).toThrow(
      'Multiple capture sources found matching display ID: 1'
    );
  });

  it('throws error if the matching source thumbnail is empty', () => {
    const s1 = createFakeSource('1', true);
    expect(() => selectCaptureSource([s1], 1)).toThrow(
      'Capture source thumbnail is empty for display ID: 1'
    );
  });

  it('throws error if the matching source thumbnail has zero size', () => {
    const s1 = createFakeSource('1', false, 0, 100);
    const s2 = createFakeSource('2', false, 100, 0);
    expect(() => selectCaptureSource([s1], 1)).toThrow(
      'Capture source thumbnail has zero size for display ID: 1'
    );
    expect(() => selectCaptureSource([s2], 2)).toThrow(
      'Capture source thumbnail has zero size for display ID: 2'
    );
  });
});
