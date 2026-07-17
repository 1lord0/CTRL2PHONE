import {
  normalizePillVisibility,
  shouldShowCompactPill,
} from '../src/lib/pillVisibility';

describe('pill visibility policy', () => {
  test.each([
    ['always', 'always'],
    ['background', 'background'],
    ['capture-only', 'capture-only'],
    ['invalid', 'always'],
    [undefined, 'always'],
  ])('normalizes %p to %s', (input, expected) => {
    expect(normalizePillVisibility(input)).toBe(expected);
  });

  test.each([
    ['always', false, false, true],
    ['always', false, true, true],
    ['background', false, false, false],
    ['background', false, true, true],
    ['background', true, false, true],
    ['capture-only', false, true, false],
    ['capture-only', true, false, true],
  ] as const)(
    '%s with selection=%s transient=%s returns %s',
    (visibility, selectionActive, transientActive, expected) => {
      expect(
        shouldShowCompactPill(visibility, { selectionActive, transientActive })
      ).toBe(expected);
    }
  );
});
