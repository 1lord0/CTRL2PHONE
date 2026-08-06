import { normalizeSettingsUpdate } from '../src/main/registerSettingsIpc';
import { createDefaultSettings } from '../src/main/settingsStore';

describe('normalizeSettingsUpdate', () => {
  it('trims and keeps a complete Supabase connection update', () => {
    const result = normalizeSettingsUpdate(createDefaultSettings(), {
      supabaseUrl: '  https://project.supabase.co  ',
      supabaseKey: '  anon-key  ',
      supabaseBucket: '  screenshots  ',
      autoCopyFromPhone: true,
    });

    expect(result).toEqual({
      ok: true,
      settings: {
        supabaseUrl: 'https://project.supabase.co',
        supabaseKey: 'anon-key',
        supabaseBucket: 'screenshots',
        autoCopyFromPhone: true,
      },
    });
  });

  it('rejects a visually misleading empty credential submission', () => {
    const result = normalizeSettingsUpdate(createDefaultSettings(), {
      supabaseUrl: '',
      supabaseKey: '',
      supabaseBucket: 'screenshots',
      autoCopyFromPhone: true,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Supabase URL ve Anon Key alanları birlikte doldurulmalıdır.',
    });
  });

  it('does not block unrelated partial updates', () => {
    const result = normalizeSettingsUpdate(createDefaultSettings(), { language: 'tr' });
    expect(result).toEqual({ ok: true, settings: { language: 'tr' } });
  });
});
