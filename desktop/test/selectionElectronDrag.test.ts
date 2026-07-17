import {
  calculateDragPreviewSize,
  executeSelectionElectronDrag,
  SelectionElectronDragPorts,
} from '../src/lib/selectionElectronDrag';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

describe('calculateDragPreviewSize', () => {
  it('fits a landscape image inside a normal 160 by 120 preview', () => {
    expect(
      calculateDragPreviewSize(
        { width: 1200, height: 800 },
        { width: 160, height: 120 }
      )
    ).toEqual({ width: 160, height: 107 });
  });

  it('fits a portrait image without stretching it', () => {
    expect(
      calculateDragPreviewSize(
        { width: 800, height: 1200 },
        { width: 160, height: 120 }
      )
    ).toEqual({ width: 80, height: 120 });
  });

  it('does not upscale an already-small image', () => {
    expect(
      calculateDragPreviewSize(
        { width: 100, height: 50 },
        { width: 160, height: 120 }
      )
    ).toEqual({ width: 100, height: 50 });
  });
});

describe('executeSelectionElectronDrag', () => {
  const bounds: Bounds = { x: 0, y: 0, width: 1536, height: 864 };

  function createPorts(): jest.Mocked<SelectionElectronDragPorts<Bounds, string>> {
    return {
      getAsset: jest.fn().mockReturnValue({ file: 'capture.png', icon: 'capture.png' }),
      getOverlayBounds: jest.fn().mockReturnValue(bounds),
      prepareOverlay: jest.fn(),
      startDrag: jest.fn(),
      restoreOverlayBounds: jest.fn(),
      finishSelection: jest.fn(),
      reportError: jest.fn(),
    };
  }

  it('moves the overlay away, starts the file drag, then finishes the selection', () => {
    const ports = createPorts();

    const result = executeSelectionElectronDrag(ports);

    expect(result).toEqual({ ok: true });
    expect(ports.prepareOverlay).toHaveBeenCalledTimes(1);
    expect(ports.startDrag).toHaveBeenCalledWith({
      file: 'capture.png',
      icon: 'capture.png',
    });
    expect(ports.restoreOverlayBounds).toHaveBeenCalledWith(bounds);
    expect(ports.finishSelection).toHaveBeenCalledWith('capture.png');
    expect(ports.prepareOverlay.mock.invocationCallOrder[0]).toBeLessThan(
      ports.startDrag.mock.invocationCallOrder[0]
    );
  });

  it('does nothing when no current drag asset exists', () => {
    const ports = createPorts();
    ports.getAsset.mockReturnValue(null);

    expect(executeSelectionElectronDrag(ports)).toEqual({
      ok: false,
      error: 'drag asset is not ready',
    });
    expect(ports.prepareOverlay).not.toHaveBeenCalled();
    expect(ports.startDrag).not.toHaveBeenCalled();
  });

  it('restores and closes the selection even if Electron startDrag throws', () => {
    const ports = createPorts();
    ports.startDrag.mockImplementation(() => {
      throw new Error('native drag failed');
    });

    expect(executeSelectionElectronDrag(ports)).toEqual({
      ok: false,
      error: 'native drag failed',
    });
    expect(ports.reportError).toHaveBeenCalledWith('native drag failed');
    expect(ports.restoreOverlayBounds).toHaveBeenCalledWith(bounds);
    expect(ports.finishSelection).toHaveBeenCalledWith('capture.png');
  });
});
