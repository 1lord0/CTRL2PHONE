import QRCode from 'qrcode';
import { registerSettingsIpc } from '../src/main/registerSettingsIpc';

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn(async () => 'data:image/png;base64,qr') },
}));

class MockIpc {
  handlers: Record<string, Function> = {};

  handle(channel: string, callback: Function): void {
    this.handlers[channel] = callback;
  }

  removeHandler(channel: string): void {
    delete this.handlers[channel];
  }
}

function createDeps() {
  return {
    isShutdownStarted: () => false,
    isMainSender: () => true,
    settingsStore: { update: jest.fn(() => ({})), save: jest.fn() },
    mainWindowController: {
      applyCompactPillVisibility: jest.fn(),
      getWindow: jest.fn(),
      getPanelMode: jest.fn(() => 'presented'),
    },
    supabaseRuntime: { invalidate: jest.fn() },
    stopActionTaskMonitor: jest.fn(async () => undefined),
    createActionPairingInvite: jest.fn(async () => ({
      channelId: '123e4567-e89b-42d3-a456-426614174000',
      inviteToken: 'i'.repeat(43),
      inviteExpiresAt: '2026-08-07T10:10:00.000Z',
    })),
    sendKeyListenerConfig: jest.fn(),
    setupPhoneSyncPolling: jest.fn(),
    setupClipboardPolling: jest.fn(),
    settings: {
      supabaseUrl: 'https://project.supabase.co',
      supabaseKey: 'anon-key',
      supabaseBucket: 'screenshots',
      language: 'tr',
    },
    getPillMaxWidth: () => 720,
    downloadedPhoneFiles: [],
    writeTextToClipboardReliable: jest.fn(),
    shellOpenExternal: jest.fn(),
    selectionSession: { active: false },
    diagnostics: { action: jest.fn(), info: jest.fn(), error: jest.fn() },
  };
}

describe('settings QR action pairing', () => {
  beforeEach(() => {
    (QRCode.toDataURL as jest.Mock).mockClear();
  });

  it('adds a fresh one-time action channel invite to the existing phone QR', async () => {
    const ipc = new MockIpc();
    const deps = createDeps();
    registerSettingsIpc(ipc as any, deps as any);

    const result = await ipc.handlers['generate-qr']({ sender: {} });

    expect(result).toMatchObject({
      ok: true,
      dataUrl: 'data:image/png;base64,qr',
      actionPairingIncluded: true,
    });
    const payload = JSON.parse((QRCode.toDataURL as jest.Mock).mock.calls[0][0]);
    expect(payload).toEqual({
      schemaVersion: 2,
      url: 'https://project.supabase.co',
      key: 'anon-key',
      bucket: 'screenshots',
      actionPairing: {
        version: 1,
        channelId: '123e4567-e89b-42d3-a456-426614174000',
        inviteToken: 'i'.repeat(43),
        inviteExpiresAt: '2026-08-07T10:10:00.000Z',
      },
    });
  });

  it('keeps legacy photo pairing usable when action setup is not installed yet', async () => {
    const ipc = new MockIpc();
    const deps = createDeps();
    deps.createActionPairingInvite.mockRejectedValueOnce(new Error('function_missing'));
    registerSettingsIpc(ipc as any, deps as any);

    const result = await ipc.handlers['generate-qr']({ sender: {} });

    expect(result).toMatchObject({
      ok: true,
      actionPairingIncluded: false,
      warning: 'function_missing',
    });
    const payload = JSON.parse((QRCode.toDataURL as jest.Mock).mock.calls[0][0]);
    expect(payload.actionPairing).toBeUndefined();
    expect(deps.diagnostics.error).toHaveBeenCalledWith(
      'action_pairing',
      'qr_pairing_invite_failed',
      expect.any(Error)
    );
  });

  it('drains the old task subscription before invalidating changed Supabase settings', async () => {
    const ipc = new MockIpc();
    const deps = createDeps();
    let releaseStop!: () => void;
    deps.stopActionTaskMonitor.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        })
    );
    deps.settingsStore.update.mockReturnValueOnce({ supabaseChanged: true });
    registerSettingsIpc(ipc as any, deps as any);

    const saving = ipc.handlers['save-settings'](
      { sender: {} },
      {
        supabaseUrl: 'https://new-project.supabase.co',
        supabaseKey: 'new-anon-key',
        supabaseBucket: 'screenshots',
        autoCopyFromPhone: true,
      }
    );
    await Promise.resolve();

    expect(deps.stopActionTaskMonitor).toHaveBeenCalledTimes(1);
    expect(deps.supabaseRuntime.invalidate).not.toHaveBeenCalled();
    releaseStop();
    await expect(saving).resolves.toEqual({ ok: true });
    expect(deps.supabaseRuntime.invalidate).toHaveBeenCalledTimes(1);
  });
});
