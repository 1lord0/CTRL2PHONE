import { guardLocalClipboard, isLocalClipboardGuarded } from '../src/lib/clipboardWrite';

describe('clipboard guard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-04T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is not guarded initially', () => {
    expect(isLocalClipboardGuarded()).toBe(false);
  });

  it('guards for the requested window', () => {
    guardLocalClipboard(5000);
    expect(isLocalClipboardGuarded()).toBe(true);
    jest.advanceTimersByTime(4999);
    expect(isLocalClipboardGuarded()).toBe(true);
    jest.advanceTimersByTime(2);
    expect(isLocalClipboardGuarded()).toBe(false);
  });

  it('extends the guard when called again', () => {
    guardLocalClipboard(1000);
    jest.advanceTimersByTime(800);
    guardLocalClipboard(5000);
    jest.advanceTimersByTime(1500);
    expect(isLocalClipboardGuarded()).toBe(true);
  });
});