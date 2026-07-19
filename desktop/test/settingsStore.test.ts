import {
  createDefaultSettings,
  createSettingsStore,
  type SettingsStorePorts,
} from '../src/main/settingsStore';

function createPorts(initialFile: string | null = null): {
  readonly ports: SettingsStorePorts;
  readonly written: () => string | null;
} {
  let file = initialFile;
  return {
    ports: {
      persistence: {
        resolvePath: () => 'C:\\settings.json',
        exists: () => file !== null,
        readText: () => file ?? '',
        writeText: (_filePath, content) => {
          file = content;
        },
      },
      encryption: {
        isAvailable: () => true,
        encrypt: value => `encrypted:${value}`,
        decrypt: value => value.replace(/^encrypted:/, ''),
      },
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
    written: () => file,
  };
}

describe('settings store', () => {
  it('loads accepted settings while preserving the live object identity', () => {
    // Given a persisted settings file with encrypted secrets and unknown fields
    const persisted = JSON.stringify({
      prompt: 'custom prompt',
      supabaseKey: 'encrypted:supabase-secret',
      aiApiKey: 'encrypted:ai-secret',
      pillVisibility: 'capture-only',
      unknownField: 'ignored',
    });
    const settings = createDefaultSettings();
    const originalIdentity = settings;
    const { ports } = createPorts(persisted);
    const store = createSettingsStore(settings, ports);

    // When settings are loaded
    store.load();

    // Then accepted values populate the same object and secrets are decrypted
    expect(store.settings).toBe(originalIdentity);
    expect(settings.prompt).toBe('custom prompt');
    expect(settings.supabaseKey).toBe('supabase-secret');
    expect(settings.aiApiKey).toBe('ai-secret');
    expect(settings.pillVisibility).toBe('capture-only');
    expect(Object.hasOwn(settings, 'unknownField')).toBe(false);
  });

  it('updates the supported renderer fields and reports affected runtimes', () => {
    // Given default live settings
    const settings = createDefaultSettings();
    const { ports } = createPorts();
    const store = createSettingsStore(settings, ports);

    // When Supabase and pill visibility settings change
    const result = store.update({
      prompt: 'updated',
      supabaseUrl: 'https://example.supabase.co',
      pillVisibility: 'capture-only',
      panelPinned: true,
    });

    // Then supported fields change and unrelated panel state is left to its owner
    expect(result).toEqual({ supabaseChanged: true, pillVisibilityChanged: true });
    expect(settings.prompt).toBe('updated');
    expect(settings.supabaseUrl).toBe('https://example.supabase.co');
    expect(settings.pillVisibility).toBe('capture-only');
    expect(settings.panelPinned).toBe(false);
  });

  it('encrypts secrets for persistence without mutating runtime values', () => {
    // Given runtime settings containing plain-text secrets
    const settings = createDefaultSettings();
    settings.supabaseKey = 'supabase-secret';
    settings.aiApiKey = 'ai-secret';
    const fixture = createPorts();
    const store = createSettingsStore(settings, fixture.ports);

    // When settings are saved
    store.save();

    // Then the file contains encrypted values and runtime settings remain plain
    const written = fixture.written();
    expect(written).not.toBeNull();
    expect(JSON.parse(written ?? '{}')).toMatchObject({
      supabaseKey: 'encrypted:supabase-secret',
      aiApiKey: 'encrypted:ai-secret',
    });
    expect(settings.supabaseKey).toBe('supabase-secret');
    expect(settings.aiApiKey).toBe('ai-secret');
  });

  it('defaults autoCopyFromPhone to true in default settings', () => {
    const settings = createDefaultSettings();
    expect(settings.autoCopyFromPhone).toBe(true);
  });

  it('preserves persisted autoCopyFromPhone false value', () => {
    const persisted = JSON.stringify({
      autoCopyFromPhone: false,
    });
    const settings = createDefaultSettings();
    expect(settings.autoCopyFromPhone).toBe(true); // default is true
    
    const { ports } = createPorts(persisted);
    const store = createSettingsStore(settings, ports);
    store.load();
    
    expect(settings.autoCopyFromPhone).toBe(false); // loads false from file
  });

  it('round-trips all pillVisibility modes unchanged', () => {
    const modes = ['always', 'background', 'capture-only'] as const;
    for (const mode of modes) {
      const persisted = JSON.stringify({
        pillVisibility: mode,
      });
      const settings = createDefaultSettings();
      const fixture = createPorts(persisted);
      const store = createSettingsStore(settings, fixture.ports);
      store.load();
      expect(settings.pillVisibility).toBe(mode);
      
      store.save();
      const written = JSON.parse(fixture.written() ?? '{}');
      expect(written.pillVisibility).toBe(mode);
    }
  });
});
