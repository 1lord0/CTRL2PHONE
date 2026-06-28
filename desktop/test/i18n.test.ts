import { resolveLang, getStrings } from '../src/lib/i18n';

describe('resolveLang', () => {
  it('honors an explicit language setting regardless of OS locale', () => {
    expect(resolveLang('en', 'tr-TR')).toBe('en');
    expect(resolveLang('tr', 'en-US')).toBe('tr');
  });

  it("maps 'system' to Turkish only for tr* locales", () => {
    expect(resolveLang('system', 'tr')).toBe('tr');
    expect(resolveLang('system', 'tr-TR')).toBe('tr');
    expect(resolveLang('system', 'TR-tr')).toBe('tr');
    expect(resolveLang('system', 'en-US')).toBe('en');
    expect(resolveLang('system', 'de')).toBe('en');
  });

  it("falls back to English for a missing/garbage system locale", () => {
    expect(resolveLang('system', '')).toBe('en');
    expect(resolveLang('system', undefined as unknown as string)).toBe('en');
  });
});

describe('getStrings', () => {
  it('returns a complete map for each language', () => {
    const e = getStrings('en');
    const t = getStrings('tr');
    expect(e['btn.save']).toBe('Save settings');
    expect(t['btn.save']).toBe('Ayarları kaydet');
  });

  it('has identical key sets across en and tr (no missing translation)', () => {
    const e = Object.keys(getStrings('en')).sort();
    const t = Object.keys(getStrings('tr')).sort();
    expect(t).toEqual(e);
  });

  it('returns a copy, not the live dictionary', () => {
    const a = getStrings('en');
    a['btn.save'] = 'mutated';
    expect(getStrings('en')['btn.save']).toBe('Save settings');
  });
});
