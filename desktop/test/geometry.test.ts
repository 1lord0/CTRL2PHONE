import {
  getVirtualBounds,
  toAbsoluteRect,
  clampRectToDisplay,
  computeCropRect,
} from '../src/lib/geometry';

describe('getVirtualBounds', () => {
  it('returns the single display bounds', () => {
    expect(getVirtualBounds([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }])).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('covers two side-by-side displays', () => {
    const r = getVirtualBounds([
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: 1920, y: 0, width: 1280, height: 1024 } },
    ]);
    expect(r).toEqual({ x: 0, y: 0, width: 3200, height: 1080 });
  });

  it('handles a monitor positioned to the left (negative origin)', () => {
    const r = getVirtualBounds([
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: -1280, y: 0, width: 1280, height: 1024 } },
    ]);
    expect(r).toEqual({ x: -1280, y: 0, width: 3200, height: 1080 });
  });

  it('returns a zero rect when there are no displays', () => {
    expect(getVirtualBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('covers vertically-stacked displays (negative y origin)', () => {
    const r = getVirtualBounds([
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: 0, y: -600, width: 1920, height: 600 } },
    ]);
    expect(r).toEqual({ x: 0, y: -600, width: 1920, height: 1680 });
  });
});

describe('toAbsoluteRect', () => {
  it('offsets the rect by the virtual-desktop origin', () => {
    expect(
      toAbsoluteRect({ x: 10, y: 20, width: 100, height: 50 }, { x: -1280, y: -200 })
    ).toEqual({ x: -1270, y: -180, width: 100, height: 50 });
  });
});

describe('clampRectToDisplay', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  it('leaves a fully-contained rect unchanged', () => {
    expect(clampRectToDisplay({ x: 100, y: 100, width: 200, height: 200 }, display)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
  });

  it('clamps a rect that overflows the display edges', () => {
    expect(clampRectToDisplay({ x: 1800, y: 1000, width: 400, height: 400 }, display)).toEqual({
      x: 1800,
      y: 1000,
      width: 120,
      height: 80,
    });
  });

  it('returns zero size when the rect is entirely outside', () => {
    const r = clampRectToDisplay({ x: 3000, y: 3000, width: 100, height: 100 }, display);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });

  it('clamps a rect that overflows the top/left edges', () => {
    expect(clampRectToDisplay({ x: -50, y: -50, width: 200, height: 200 }, display)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 150,
    });
  });
});

describe('computeCropRect', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  it('uses scale 1 when the image matches the display size', () => {
    expect(
      computeCropRect(
        { x: 100, y: 50, width: 200, height: 100 },
        display,
        { width: 1920, height: 1080 },
        1
      )
    ).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it('derives fractional scale (150%) from the captured image size', () => {
    expect(
      computeCropRect(
        { x: 100, y: 50, width: 200, height: 100 },
        display,
        { width: 2880, height: 1620 },
        1.5
      )
    ).toEqual({ x: 150, y: 75, width: 300, height: 150 });
  });

  it('subtracts the display origin before scaling', () => {
    const d = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(
      computeCropRect(
        { x: 2020, y: 10, width: 100, height: 100 },
        d,
        { width: 1920, height: 1080 },
        1
      )
    ).toEqual({ x: 100, y: 10, width: 100, height: 100 });
  });

  it('falls back to scaleFactor when the display has zero size', () => {
    const d = { x: 0, y: 0, width: 0, height: 0 };
    expect(
      computeCropRect({ x: 10, y: 10, width: 20, height: 20 }, d, { width: 100, height: 100 }, 2)
    ).toEqual({ x: 20, y: 20, width: 40, height: 40 });
  });

  it('falls back to scaleFactor when the captured image has zero size', () => {
    // non-zero display but zero image -> computed scale 0 -> guard -> scaleFactor
    expect(
      computeCropRect(
        { x: 10, y: 10, width: 20, height: 20 },
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 0, height: 0 },
        2
      )
    ).toEqual({ x: 20, y: 20, width: 40, height: 40 });
  });

  it('uses scale 1 when scaleFactor is falsy and no image scale exists', () => {
    expect(
      computeCropRect(
        { x: 10, y: 10, width: 20, height: 20 },
        { x: 0, y: 0, width: 0, height: 0 },
        { width: 0, height: 0 },
        0
      )
    ).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });
});
