import type { SupabaseClient } from '@supabase/supabase-js';
import { createElectronClipboardSyncAdapter } from '../src/main/electronClipboardSyncAdapter';

describe('Electron clipboard sync adapter', () => {
  it('wires Electron callbacks and all clipboard_sync table operations', async () => {
    const selectBuilder = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({
        data: [{ id: 'row-1', content: 'telefondan' }],
        error: null,
      }),
    };
    const deleteBuilder = {
      eq: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const table = {
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      select: jest.fn(() => selectBuilder),
      delete: jest.fn(() => deleteBuilder),
    };
    const client = { from: jest.fn(() => table) } as unknown as SupabaseClient;
    const context = {
      client,
      url: 'https://example.supabase.co',
      bucket: 'screenshots',
      generation: 4,
    };
    const readClipboard = jest.fn(() => 'masaüstünden');
    const writeClipboard = jest.fn();
    const setStatus = jest.fn();
    const ports = createElectronClipboardSyncAdapter({
      runtime: { getContext: () => context, isCurrent: (value) => value === context },
      readClipboard,
      writeClipboard,
      isClipboardGuarded: () => false,
      setStatus,
      setResponse: jest.fn(),
      showNotification: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });

    expect(ports.readClipboard()).toBe('masaüstünden');
    ports.writeClipboard('telefondan');
    await expect(ports.insertDesktopText(context, 'masaüstünden')).resolves.toBeNull();
    await expect(ports.fetchOldestMobileText(context)).resolves.toEqual({
      row: { id: 'row-1', content: 'telefondan' },
      error: null,
    });
    await expect(ports.deleteMobileText(context, 'row-1')).resolves.toBeNull();

    expect(writeClipboard).toHaveBeenCalledWith('telefondan');
    expect(client.from).toHaveBeenCalledTimes(3);
    expect(client.from).toHaveBeenNthCalledWith(1, 'clipboard_sync');
    expect(table.insert).toHaveBeenCalledWith({
      content: 'masaüstünden',
      source: 'desktop',
    });
    expect(selectBuilder.eq).toHaveBeenCalledWith('source', 'mobile');
    expect(selectBuilder.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(deleteBuilder.eq).toHaveBeenCalledWith('id', 'row-1');
    expect(ports.setStatus).toBe(setStatus);
  });
});
