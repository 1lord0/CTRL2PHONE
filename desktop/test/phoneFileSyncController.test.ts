import { createPhoneFileSyncController } from '../src/main/phoneFileSyncController';

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
    const downloads: string[] = [];
    const deleted: string[] = [];
    const notifications: string[][] = [];
    let enabled = true;
    let files = [
      { name: 'one.png', id: 'one' },
      { name: 'two.png', id: 'two' },
    ];
    const controller = createPhoneFileSyncController<FixtureContext, string>({
      isEnabled: () => enabled,
      getContext: () => context,
      isContextCurrent: () => true,
      isSynced: (_context, path) => synced.has(path),
      markSynced: (_context, path) => synced.add(path),
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
      subscribe: () => 'subscription',
      removeSubscription: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    });
    return {
      controller,
      synced,
      downloads,
      deleted,
      notifications,
      disable: () => {
        enabled = false;
      },
      setFiles: (next: typeof files) => {
        files = next;
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
});
