import { Rect } from '../types';

export interface SelectionDragInputParams {
  overlayActive: boolean;
  sessionIdCurrent: boolean;
  selectionRect: Rect | null;
  dragProxyReady: boolean;
  annotationToolActive: boolean;
  pointerX: number;
  pointerY: number;
  interactiveElementHovered: boolean;
  previousPassthrough: boolean;
}

export function determineSelectionDragPassthrough(
  params: SelectionDragInputParams
): 'passthrough_on' | 'passthrough_off' | 'no_change' {
  const {
    overlayActive,
    sessionIdCurrent,
    selectionRect,
    dragProxyReady,
    annotationToolActive,
    pointerX,
    pointerY,
    interactiveElementHovered,
    previousPassthrough,
  } = params;

  if (
    !overlayActive ||
    !sessionIdCurrent ||
    !selectionRect ||
    !dragProxyReady ||
    annotationToolActive ||
    interactiveElementHovered
  ) {
    return previousPassthrough ? 'passthrough_off' : 'no_change';
  }

  const inside =
    pointerX >= selectionRect.x &&
    pointerX <= selectionRect.x + selectionRect.width &&
    pointerY >= selectionRect.y &&
    pointerY <= selectionRect.y + selectionRect.height;

  if (inside) {
    return previousPassthrough ? 'no_change' : 'passthrough_on';
  } else {
    return previousPassthrough ? 'passthrough_off' : 'no_change';
  }
}
