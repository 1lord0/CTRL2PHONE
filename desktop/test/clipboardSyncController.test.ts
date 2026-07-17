import { createClipboardSyncController } from '../src/main/clipboardSyncController';

interface FixtureContext {
  readonly generation: number;
}

describe('clipboard sync controller', () => {
  function createFixture() {
    const context = { generation: 1 };
    const statuses: string[] = [];
    const responses: string[] = [];
    const notifications: Array<{ title: string; body: string }> = [];
    const inserted: string[] = [];
    const deleted: string[] = [];
    let clipboardText = '  masaüstü metni  ';
    let guarded = false;
    let current = true;
    let row: { id: string; content: string } | null = null;
    const controller = createClipboardSyncController<FixtureContext>({
      readClipboard: () => clipboardText,
      writeClipboard: value => {
        clipboardText = value;
      },
      isClipboardGuarded: () => guarded,
      getContext: () => context,
      isContextCurrent: () => current,
      insertDesktopText: async (_context, text) => {
        inserted.push(text);
        return null;
      },
      fetchOldestMobileText: async () => ({ row, error: null }),
      deleteMobileText: async (_context, id) => {
        deleted.push(id);
        return null;
      },
      setStatus: value => statuses.push(value),
      setResponse: value => responses.push(value),
      showNotification: (title, body) => notifications.push({ title, body }),
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    });
    return {
      controller,
      context,
      statuses,
      responses,
      notifications,
      inserted,
      deleted,
      clipboardText: () => clipboardText,
      setClipboardText: (value: string) => {
        clipboardText = value;
      },
      setGuarded: (value: boolean) => {
        guarded = value;
      },
      setCurrent: (value: boolean) => {
        current = value;
      },
      setRow: (value: { id: string; content: string } | null) => {
        row = value;
      },
    };
  }

  it('trims and sends desktop clipboard text through the active context', async () => {
    // Given local clipboard text and an active Supabase context
    const fixture = createFixture();

    // When the clipboard is sent to the phone
    const result = await fixture.controller.sendToPhone();

    // Then the trimmed text is inserted and user feedback is emitted
    expect(result).toEqual({ ok: true });
    expect(fixture.inserted).toEqual(['masaüstü metni']);
    expect(fixture.notifications).toEqual([
      { title: 'Metin Telefona Gönderildi', body: 'masaüstü metni' },
    ]);
    expect(fixture.statuses.at(-1)).toBe('Pano metni telefona gönderildi');
  });

  it('does not report success when the Supabase context becomes stale', async () => {
    // Given a send operation whose context becomes stale after insertion
    const fixture = createFixture();
    fixture.setCurrent(false);

    // When the send completes
    const result = await fixture.controller.sendToPhone();

    // Then the stale configuration is reported without a success notification
    expect(result).toEqual({
      ok: false,
      error: 'Supabase ayarları gönderim sırasında değişti',
    });
    expect(fixture.notifications).toHaveLength(0);
  });

  it('copies each unseen mobile row once and always requests cleanup', async () => {
    // Given an unseen mobile clipboard row
    const fixture = createFixture();
    fixture.setRow({ id: 'row-1', content: 'telefondan gelen' });

    // When the same row is observed twice
    await fixture.controller.checkFromMobile();
    await fixture.controller.checkFromMobile();

    // Then clipboard feedback occurs once while cleanup is attempted each time
    expect(fixture.clipboardText()).toBe('telefondan gelen');
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.deleted).toEqual(['row-1', 'row-1']);
  });

  it('skips remote polling while the local clipboard guard is active', async () => {
    // Given an active guard protecting a fresh local clipboard value
    const fixture = createFixture();
    fixture.setClipboardText('korunan');
    fixture.setGuarded(true);
    fixture.setRow({ id: 'row-1', content: 'eski uzak değer' });

    // When the mobile clipboard check runs
    await fixture.controller.checkFromMobile();

    // Then neither the clipboard nor the remote row is touched
    expect(fixture.clipboardText()).toBe('korunan');
    expect(fixture.deleted).toHaveLength(0);
    expect(fixture.notifications).toHaveLength(0);
  });
});
