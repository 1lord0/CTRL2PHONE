import { determineSelectionDragPassthrough, SelectionDragInputParams } from '../src/lib/selectionDragInput';

describe('determineSelectionDragPassthrough', () => {
  let baseParams: SelectionDragInputParams;

  beforeEach(() => {
    baseParams = {
      overlayActive: true,
      sessionIdCurrent: true,
      selectionRect: { x: 100, y: 100, width: 200, height: 200 },
      dragProxyReady: true,
      annotationToolActive: false,
      pointerX: 150,
      pointerY: 150,
      interactiveElementHovered: false,
      previousPassthrough: false,
    };
  });

  it('turns passthrough_on if pointer is inside selection rect and not previously passthrough', () => {
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('passthrough_on');
  });

  it('returns no_change if pointer inside selection rect and already passthrough', () => {
    baseParams.previousPassthrough = true;
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('no_change');
  });

  it('turns passthrough_off if pointer moves outside selection rect and was passthrough', () => {
    baseParams.previousPassthrough = true;
    baseParams.pointerX = 50; // Outside
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('passthrough_off');
  });

  it('returns no_change if pointer moves outside and was not passthrough', () => {
    baseParams.previousPassthrough = false;
    baseParams.pointerX = 50;
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('no_change');
  });

  it('turns passthrough_off if hover is on interactive element', () => {
    baseParams.previousPassthrough = true;
    baseParams.interactiveElementHovered = true;
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('passthrough_off');
  });

  it('turns passthrough_off if annotation tool is active', () => {
    baseParams.previousPassthrough = true;
    baseParams.annotationToolActive = true;
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('passthrough_off');
  });

  it('turns passthrough_off if drag proxy is not ready', () => {
    baseParams.previousPassthrough = true;
    baseParams.dragProxyReady = false;
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('passthrough_off');
  });

  it('turns passthrough_off if session is not current', () => {
    baseParams.previousPassthrough = true;
    baseParams.sessionIdCurrent = false;
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('passthrough_off');
  });

  it('turns passthrough_off if overlay is not active', () => {
    baseParams.previousPassthrough = true;
    baseParams.overlayActive = false;
    const result = determineSelectionDragPassthrough(baseParams);
    expect(result).toBe('passthrough_off');
  });
});
