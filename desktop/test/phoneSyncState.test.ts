import { createPhoneSyncState, makePhoneSyncKey } from '../src/main/phoneSyncState';

describe('phone sync state', () => {
  function createFixture(initialFile: string | null = null, maxEntries = 3) {
    let file = initialFile;
    const warnings: string[] = [];
    const state = createPhoneSyncState(
      {
        resolvePath: () => 'C:\\phone-sync-state.json',
        exists: () => file !== null,
        readText: () => file ?? '',
        writeText: (_filePath, content) => {
          file = content;
        },
        warn: message => warnings.push(message),
        error: message => warnings.push(message),
      },
      maxEntries
    );
    return { state, file: () => file, warnings };
  }

  it('loads only valid string keys and ignores malformed persisted entries', () => {
    // Given a persisted state containing valid and invalid keys
    const fixture = createFixture(JSON.stringify({ synced: ['one', 2, null, 'two'] }));

    // When the state is loaded
    fixture.state.load();

    // Then only string keys are restored
    expect(fixture.state.hasKey('one')).toBe(true);
    expect(fixture.state.hasKey('two')).toBe(true);
    expect(fixture.state.hasKey('2')).toBe(false);
  });

  it('keeps the newest keys within the configured persistence limit', () => {
    // Given more synchronized files than the state limit
    const fixture = createFixture(null, 2);
    const context = { url: 'https://example.supabase.co', bucket: 'screenshots' };

    // When each synchronized file is recorded
    fixture.state.markSynced(context, 'to_pc/one.png');
    fixture.state.markSynced(context, 'to_pc/two.png');
    fixture.state.markSynced(context, 'to_pc/three.png');

    // Then only the newest keys remain in memory and on disk
    expect(fixture.state.isSynced(context, 'to_pc/one.png')).toBe(false);
    expect(fixture.state.isSynced(context, 'to_pc/two.png')).toBe(true);
    expect(fixture.state.isSynced(context, 'to_pc/three.png')).toBe(true);
    expect(JSON.parse(fixture.file() ?? '{}')).toEqual({
      synced: [
        'https://example.supabase.co|screenshots|to_pc/two.png',
        'https://example.supabase.co|screenshots|to_pc/three.png',
      ],
    });
  });

  it('uses stable metadata precedence when building synchronization keys', () => {
    // Given a Supabase namespace and file metadata
    const context = { url: 'https://example.supabase.co', bucket: 'custom' };

    // When keys are built with an id, timestamp, or path only
    const withId = makePhoneSyncKey(context, 'to_pc/file.png', {
      id: 'row-id',
      updated_at: 'later',
    });
    const withTimestamp = makePhoneSyncKey(context, 'to_pc/file.png', {
      updated_at: '2026-07-17',
    });
    const withPath = makePhoneSyncKey(context, 'to_pc/file.png');

    // Then row id wins, followed by timestamp and finally the path
    expect(withId).toBe('https://example.supabase.co|custom|id:row-id');
    expect(withTimestamp).toBe(
      'https://example.supabase.co|custom|to_pc/file.png@2026-07-17'
    );
    expect(withPath).toBe('https://example.supabase.co|custom|to_pc/file.png');
  });

  it('recovers from malformed JSON with an empty state', () => {
    // Given a corrupt persisted state file
    const fixture = createFixture('{not-json');

    // When loading is attempted
    fixture.state.load();

    // Then the state is empty and the failure is reported
    expect(fixture.state.hasKey('anything')).toBe(false);
    expect(fixture.warnings).toHaveLength(1);
  });
});
