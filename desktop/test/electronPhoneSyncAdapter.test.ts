import type { SupabaseClient } from '@supabase/supabase-js';
import { createElectronPhoneSyncAdapter } from '../src/main/electronPhoneSyncAdapter';

describe('Electron phone sync adapter', () => {
  function createFixture() {
    const storage = {
      list: jest.fn().mockResolvedValue({
        data: [{ name: 'phone.png', id: 'id-1', updated_at: '2026-08-06' }],
        error: null,
      }),
      download: jest.fn().mockResolvedValue({
        data: { arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer },
        error: null,
      }),
      remove: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    let realtimeCallback: ((payload: { new: Record<string, unknown> }) => void) | null = null;
    const channel = {
      on: jest.fn((_event, _filter, callback) => {
        realtimeCallback = callback;
        return channel;
      }),
      subscribe: jest.fn((callback) => {
        callback('SUBSCRIBED');
        return channel;
      }),
    };
    const client = {
      storage: { from: jest.fn(() => storage) },
      channel: jest.fn(() => channel),
      removeChannel: jest.fn().mockResolvedValue('ok'),
    } as unknown as SupabaseClient;
    const context = {
      client,
      url: 'https://example.supabase.co',
      bucket: 'screenshots',
      generation: 7,
    };
    const write = jest.fn().mockResolvedValue({ ok: true, localPath: 'C:/safe/phone.png' });
    const cleanup = jest.fn().mockResolvedValue({ ok: true });
    const store = { rootPath: 'C:/safe', write, cleanup };
    const isCurrent = jest.fn(() => true);
    const image = { isEmpty: jest.fn(() => false) };
    const writeClipboardImage = jest.fn();
    const guardLocalClipboard = jest.fn();
    const notifyDownloads = jest.fn();
    const error = jest.fn();
    const adapter = createElectronPhoneSyncAdapter({
      isEnabled: () => true,
      runtime: { getContext: () => context, isCurrent },
      state: { isSynced: () => false, markSynced: jest.fn() },
      downloadStore: Promise.resolve({ ok: true, store }),
      createImageFromBuffer: () => image,
      writeClipboardImage,
      guardLocalClipboard,
      notifyDownloads,
      log: jest.fn(),
      warn: jest.fn(),
      error,
    });

    return {
      adapter,
      context,
      storage,
      channel,
      client,
      getRealtimeCallback: () => realtimeCallback,
      write,
      cleanup,
      image,
      writeClipboardImage,
      guardLocalClipboard,
      notifyDownloads,
      error,
    };
  }

  it('wires list, download, validation, clipboard, and durable asset storage', async () => {
    const fixture = createFixture();

    await expect(fixture.adapter.ports.listRemoteFiles(fixture.context)).resolves.toEqual({
      files: [{ name: 'phone.png', id: 'id-1', updated_at: '2026-08-06' }],
      error: null,
    });
    await expect(
      fixture.adapter.ports.downloadFile(fixture.context, { name: 'phone.png' }, 0)
    ).resolves.toBe('C:/safe/phone.png');

    expect(fixture.storage.download).toHaveBeenCalledWith('to_pc/phone.png');
    expect(fixture.image.isEmpty).toHaveBeenCalled();
    expect(fixture.guardLocalClipboard).toHaveBeenCalledWith(6000);
    expect(fixture.writeClipboardImage).toHaveBeenCalledWith(fixture.image);
    expect(fixture.write).toHaveBeenCalledWith('phone.png', Buffer.from([1, 2, 3]));
  });

  it('wires realtime delivery, removal, notifications, and cleanup', async () => {
    const fixture = createFixture();
    const onFile = jest.fn();
    const onSubscribed = jest.fn();

    const subscription = fixture.adapter.ports.subscribe(fixture.context, onFile, onSubscribed);
    fixture.getRealtimeCallback()?.({
      new: { name: 'to_pc/live.png', id: 'live-id', updated_at: 'now' },
    });
    fixture.adapter.ports.notifyDownloads(['C:/safe/live.png']);
    await fixture.adapter.ports.removeSubscription(subscription);
    await fixture.adapter.cleanupDownloads();

    expect(onSubscribed).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith({
      name: 'to_pc/live.png',
      id: 'live-id',
      updated_at: 'now',
    });
    expect(fixture.notifyDownloads).toHaveBeenCalledWith(['C:/safe/live.png']);
    expect(fixture.client.removeChannel).toHaveBeenCalledWith(fixture.channel);
    expect(fixture.cleanup).toHaveBeenCalledTimes(1);
  });
});
