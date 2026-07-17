import type { PillVisibility } from '../types';

export function normalizePillVisibility(value: unknown): PillVisibility {
  return value === 'background' || value === 'capture-only' ? value : 'always';
}

export function shouldShowCompactPill(
  visibility: PillVisibility,
  state: { selectionActive: boolean; transientActive: boolean }
): boolean {
  if (visibility === 'capture-only') return state.selectionActive;
  if (state.transientActive) return true;
  if (visibility === 'always') return true;
  return state.selectionActive;
}
