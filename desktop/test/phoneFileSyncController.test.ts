import {
  createPhoneFileSyncController,
  type RemotePhoneFile,
} from '../src/main/phoneFileSyncController';

type FixtureContext = {
  readonly generation: number;
  readonly url: string;
  readonly bucket: string;
};

describe('phone file sync controller', () => {
  function createFixture() {
    const context: FixtureContext = {
      generation: 1,
      url: 'https://example.supabase.co',
      bucket: 'screenshots',
    };
    const synced = new Set<string>();
    const syncedChecks: string[] = [];
    const downloads: string[] = [];
    const marked: string[] = [];
    const deleted: string[] = [];
    const notifications: string[][] = [];
    const errors: string[] = [];
    let enabled = true;
    let files: readonly RemotePhoneFile[] = [
      { name: 'one.png', id: 'one' },
      { name: 'two.png', id: 'two' },
    ];
    let realtimeHandler: ((file: RemotePhoneFile) => void) | null = null;
    const controller = createPhoneFileSyncController<FixtureContext, string>({
      isEnabled: () => enabled,
      getContext: () => context,
      isContextCurrent: () => true,
      isSynced: (_context, path) => {
        syncedChecks.push(path);
        return synced.has(path);
      },
      markSynced: (_context, path) => {
        marked.push(path);
        synced.add(path);
      },
      listRemoteFiles: async () => ({ files, error: null }),
      downloadFile: async (_context, file) => {
        downloads.push(file.name);
        return `C:\\temp\\${file.name}`;
      },
      deleteRemoteFile: async (_context, path) => {
        deleted.push(path);
        return null;
      },
      notifyDownloads: paths => notifications.push([...paths]),
      subscribe: (_context, onFile) => {
        realtimeHandler = onFile;
        return 'subscription';
      },
      removeSubscription: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
      error: (message) => errors.push(message),
    });
    return {
      controller,
      synced,
      syncedChecks,
      downloads,
      marked,
      deleted,
      notifications,
      errors,
      disable: () => {
        enabled = false;
      },
      setFiles: (next: typeof files) => {
        files = next;
      },
      setRawFiles: (json: string) => {
        files = JSON.parse(json);
      },
      emitRawRealtime: (json: string) => {
        const callback = realtimeHandler;
        if (!callback) throw new Error('Realtime fixture is not subscribed');
        callback(JSON.parse(json));
      },
    };
  }

  it('downloads pending files and reports the completed local paths', async () => {
    // Given two unseen remote phone files
    const fixture = createFixture();

    // When the fallback synchronization check runs
    await fixture.controller.check();

    // Then both files are recorded, deleted remotely, and notified together
    expect(fixture.downloads).toEqual(['one.png', 'two.png']);
    expect(fixture.deleted).toEqual(['to_pc/one.png', 'to_pc/two.png']);
    expect(fixture.notifications).toEqual([
      ['C:\\temp\\one.png', 'C:\\temp\\two.png'],
    ]);
  });

  it('cleans an already synchronized remote file without downloading it again', async () => {
    // Given a remote file already present in synchronization state
    const fixture = createFixture();
    fixture.synced.add('to_pc/one.png');
    fixture.setFiles([{ name: 'one.png', id: 'one' }]);

    // When the fallback synchronization check runs
    await fixture.controller.check();

    // Then the duplicate is only removed from remote storage
    expect(fixture.downloads).toHaveLength(0);
    expect(fixture.deleted).toEqual(['to_pc/one.png']);
    expect(fixture.notifications).toHaveLength(0);
  });

  it('does no remote work while phone synchronization is disabled', async () => {
    // Given phone synchronization disabled in settings
    const fixture = createFixture();
    fixture.disable();

    // When synchronization is checked
    await fixture.controller.check();

    // Then no remote file is listed or downloaded
    expect(fixture.downloads).toHaveLength(0);
    expect(fixture.deleted).toHaveLength(0);
    expect(fixture.notifications).toHaveLength(0);
  });

  it('rejects invalid remote file names and executes no side effects', async () => {
    // Given remote files with invalid names (traversal, bad extensions)
    const fixture = createFixture();
    fixture.setFiles([
      { name: '../traversal.png', id: '1' },
      { name: 'malicious.txt', id: '2' },
      { name: 'C:\\absolute.png', id: '3' },
      { name: '', id: '4' },
    ]);

    // When sync is run
    await fixture.controller.check();

    // Then no downloads, no deletions, no notifications occur
    expect(fixture.downloads).toHaveLength(0);
    expect(fixture.syncedChecks).toHaveLength(0);
    expect(fixture.marked).toHaveLength(0);
    expect(fixture.deleted).toHaveLength(0);
    expect(fixture.notifications).toHaveLength(0);
  });

  it('rejects malformed list metadata before every downstream side effect', async () => {
    // Given a list record with a valid-looking name but malformed external metadata
    const fixture = createFixture();
    fixture.setRawFiles('[{"name":"safe.png","id":42}]');

    // When the fallback synchronization check parses the list response
    await fixture.controller.check();

    // Then no sync state, download, mark, delete, notification, or error boundary is reached
    expect(fixture.syncedChecks).toHaveLength(0);
    expect(fixture.downloads).toHaveLength(0);
    expect(fixture.marked).toHaveLength(0);
    expect(fixture.deleted).toHaveLength(0);
    expect(fixture.notifications).toHaveLength(0);
    expect(fixture.errors).toHaveLength(0);
  });

  it('rejects a malformed list name without throwing into the controller error boundary', async () => {
    // Given a list record whose remote name is not text
    const fixture = createFixture();
    fixture.setRawFiles('[{"name":42,"id":"remote"}]');

    // When the fallback synchronization check parses the list response
    await fixture.controller.check();

    // Then it is rejected without any downstream work or unexpected runtime error
    expect(fixture.syncedChecks).toHaveLength(0);
    expect(fixture.downloads).toHaveLength(0);
    expect(fixture.marked).toHaveLength(0);
    expect(fixture.deleted).toHaveLength(0);
    expect(fixture.notifications).toHaveLength(0);
    expect(fixture.errors).toHaveLength(0);
  });

  it('rejects malformed realtime metadata before every downstream side effect', () => {
    // Given a subscribed controller and a valid-looking path with malformed metadata
    const fixture = createFixture();
    fixture.setRawFiles('[]');
    fixture.controller.setup();

    try {
      // When the realtime boundary receives the malformed record
      fixture.emitRawRealtime('{"name":"to_pc/safe.png","id":42}');

      // Then no sync state or external mutation is reached
      expect(fixture.syncedChecks).toHaveLength(0);
      expect(fixture.downloads).toHaveLength(0);
      expect(fixture.marked).toHaveLength(0);
      expect(fixture.deleted).toHaveLength(0);
      expect(fixture.notifications).toHaveLength(0);
    } finally {
      fixture.controller.stop();
    }
  });

  it('rejects a non-text realtime name without a synchronous throw', () => {
    // Given a subscribed controller with no polling records
    const fixture = createFixture();
    fixture.setRawFiles('[]');
    fixture.controller.setup();

    try {
      // When the realtime boundary receives a non-text name
      const emit = () => fixture.emitRawRealtime('{"name":42,"id":"remote"}');

      // Then the untrusted record is handled as a rejection
      expect(emit).not.toThrow();
      expect(fixture.syncedChecks).toHaveLength(0);
      expect(fixture.downloads).toHaveLength(0);
      expect(fixture.deleted).toHaveLength(0);
      expect(fixture.notifications).toHaveLength(0);
    } finally {
      fixture.controller.stop();
    }
  });
});
