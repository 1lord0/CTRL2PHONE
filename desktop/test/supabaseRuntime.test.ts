import { createDefaultSettings } from '../src/main/settingsStore';
import { createSupabaseRuntime } from '../src/main/supabaseRuntime';

interface FixtureClient {
  readonly fixtureId: number;
}

describe('Supabase runtime', () => {
  function createFixture(): {
    readonly clients: FixtureClient[];
    readonly invalidations: string[];
    readonly createRuntime: ReturnType<typeof createSupabaseRuntime>;
    readonly settings: ReturnType<typeof createDefaultSettings>;
  } {
    const clients: FixtureClient[] = [];
    const invalidations: string[] = [];
    const settings = createDefaultSettings();
    const createRuntime = createSupabaseRuntime(settings, {
      createClient: () => {
        const client = { fixtureId: clients.length + 1 };
        clients.push(client);
        return client;
      },
      onInvalidate: () => invalidations.push('invalidated'),
    });
    return { clients, invalidations, createRuntime, settings };
  }

  it('waits for credentials and reuses a client for the same configuration', () => {
    // Given an unconfigured Supabase runtime
    const fixture = createFixture();

    // When context is requested before and after credentials are supplied
    expect(fixture.createRuntime.getContext()).toBeNull();
    fixture.settings.supabaseUrl = 'https://example.supabase.co';
    fixture.settings.supabaseKey = 'secret';
    const first = fixture.createRuntime.getContext();
    const second = fixture.createRuntime.getContext();

    // Then one client is shared and the default bucket is retained
    expect(first).not.toBeNull();
    expect(second?.client).toBe(first?.client);
    expect(first?.bucket).toBe('screenshots');
    expect(fixture.clients).toHaveLength(1);
  });

  it('invalidates stale contexts and recreates the client lazily', () => {
    // Given a configured runtime with a current context
    const fixture = createFixture();
    fixture.settings.supabaseUrl = 'https://example.supabase.co';
    fixture.settings.supabaseKey = 'secret';
    const previous = fixture.createRuntime.getContext();

    // When the runtime is invalidated and requested again
    fixture.createRuntime.invalidate();
    const next = fixture.createRuntime.getContext();

    // Then polling teardown runs first and the previous context stays stale
    expect(fixture.invalidations).toEqual(['invalidated']);
    expect(previous && fixture.createRuntime.isCurrent(previous)).toBe(false);
    expect(next && fixture.createRuntime.isCurrent(next)).toBe(true);
    expect(next?.client).not.toBe(previous?.client);
    expect(fixture.clients).toHaveLength(2);
  });

  it('detects direct credential and bucket changes without accepting old contexts', () => {
    // Given a context created for the initial settings
    const fixture = createFixture();
    fixture.settings.supabaseUrl = 'https://one.supabase.co';
    fixture.settings.supabaseKey = 'first';
    const previous = fixture.createRuntime.getContext();

    // When credentials and bucket change before the next context request
    fixture.settings.supabaseUrl = 'https://two.supabase.co';
    fixture.settings.supabaseKey = 'second';
    fixture.settings.supabaseBucket = 'custom';
    const next = fixture.createRuntime.getContext();

    // Then the client is recreated and only the new context is current
    expect(previous && fixture.createRuntime.isCurrent(previous)).toBe(false);
    expect(next && fixture.createRuntime.isCurrent(next)).toBe(true);
    expect(next?.url).toBe('https://two.supabase.co');
    expect(next?.bucket).toBe('custom');
    expect(fixture.clients).toHaveLength(2);
  });
});
