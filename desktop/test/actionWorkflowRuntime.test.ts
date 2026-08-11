import {
  createActionWorkflowRuntime,
  type ActionWorkflowRuntimePorts,
  type PersistedActionWorkflowState,
  validateActionWebhookConfig,
} from '../src/main/actionWorkflowRuntime';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('test-pixels'),
]);
const SUPABASE_URL = 'https://project.supabase.co';
const CHANNEL_ID = '123e4567-e89b-42d3-a456-426614174000';
const TASK_ID = '223e4567-e89b-42d3-a456-426614174000';
const SECRET = 'w'.repeat(32);
const INTENT = {
  intentType: 'profile_research' as const,
  confidence: 0.9,
  title: 'Profil araştırması',
  rationale: 'Görünür profil adı var.',
  searchQueries: ['visible handle'],
  visibleText: ['@visible'],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createFixture() {
  const context = { generation: 1 };
  let current = true;
  let state: PersistedActionWorkflowState | null = null;
  const ports: ActionWorkflowRuntimePorts<typeof context> = {
    getConnection: jest.fn(() => ({ context, url: SUPABASE_URL })),
    isConnectionCurrent: jest.fn(() => current),
    getWebhookConfig: jest.fn(() => ({
      url: 'http://127.0.0.1:5678/webhook/ctrl2phone-action',
      secret: SECRET,
    })),
    stateStore: {
      load: jest.fn(() => state),
      save: jest.fn((next) => {
        state = structuredClone(next);
      }),
    },
    restoreSession: jest.fn(async (_context, auth) => auth),
    signInAnonymously: jest.fn(async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    })),
    createChannel: jest.fn(async () => CHANNEL_ID),
    rotateChannelInvite: jest.fn(async () => undefined),
    uploadActionInput: jest.fn(async () => undefined),
    enqueueTask: jest.fn(async () => TASK_ID),
    dispatchWebhook: jest.fn(async () => undefined),
    generateDeviceId: jest.fn(() => 'desktop-device-1'),
  };
  return {
    context,
    ports,
    getState: () => state,
    setState: (next: PersistedActionWorkflowState) => {
      state = next;
    },
    invalidate: () => {
      current = false;
    },
  };
}

describe('action workflow runtime', () => {
  it('authenticates, creates one channel, uploads privately, enqueues and dispatches metadata', async () => {
    const fixture = createFixture();
    const runtime = createActionWorkflowRuntime(fixture.ports);

    const result = await runtime.submit({
      selectionSessionId: 7,
      pngBuffer: PNG,
      intentAnalysis: INTENT,
      isCurrent: () => true,
    });

    expect(result.taskId).toBe(TASK_ID);
    expect(fixture.ports.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(fixture.ports.createChannel).toHaveBeenCalledTimes(1);
    expect(fixture.ports.uploadActionInput).toHaveBeenCalledWith(
      fixture.context,
      'ctrl2phone-action-inputs',
      expect.stringMatching(new RegExp(`^${CHANNEL_ID}/act_[0-9a-f]{64}\\.png$`)),
      PNG
    );
    expect(fixture.ports.enqueueTask).toHaveBeenCalledWith(
      fixture.context,
      expect.objectContaining({
        channelId: CHANNEL_ID,
        sourceDeviceId: 'desktop-device-1',
        sourceStoragePath: result.sourceStoragePath,
      })
    );

    const webhookRequest = (fixture.ports.dispatchWebhook as jest.Mock).mock.calls[0][0];
    expect(webhookRequest.secret).toBe(SECRET);
    expect(webhookRequest.payload).toMatchObject({
      schemaVersion: 1,
      taskId: TASK_ID,
      channelId: CHANNEL_ID,
      idempotencyKey: result.idempotencyKey,
      expectedVersion: 0,
      intentAnalysis: INTENT,
    });
    const serializedPayload = JSON.stringify(webhookRequest.payload);
    expect(serializedPayload).not.toContain(SECRET);
    expect(serializedPayload).not.toContain('access-token');
    expect(serializedPayload).not.toContain('refresh-token');
    expect(fixture.getState()?.channelId).toBe(CHANNEL_ID);
  });

  it('serializes concurrent submissions so auth and channel creation cannot race', async () => {
    const fixture = createFixture();
    const firstUpload = deferred<void>();
    const uploadStarted = deferred<void>();
    (fixture.ports.uploadActionInput as jest.Mock)
      .mockImplementationOnce(() => {
        uploadStarted.resolve();
        return firstUpload.promise;
      })
      .mockResolvedValue(undefined);
    const runtime = createActionWorkflowRuntime(fixture.ports);

    const first = runtime.submit({
      selectionSessionId: 1,
      pngBuffer: PNG,
      intentAnalysis: INTENT,
      isCurrent: () => true,
    });
    const second = runtime.submit({
      selectionSessionId: 2,
      pngBuffer: PNG,
      intentAnalysis: INTENT,
      isCurrent: () => true,
    });
    await uploadStarted.promise;
    expect(fixture.ports.signInAnonymously).toHaveBeenCalledTimes(1);

    firstUpload.resolve();
    await Promise.all([first, second]);

    expect(fixture.ports.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(fixture.ports.createChannel).toHaveBeenCalledTimes(1);
    expect(fixture.ports.restoreSession).toHaveBeenCalledTimes(1);
  });

  it('stops before enqueue and webhook if shutdown invalidates work during upload', async () => {
    const fixture = createFixture();
    const upload = deferred<void>();
    const uploadStarted = deferred<void>();
    (fixture.ports.uploadActionInput as jest.Mock).mockImplementation(() => {
      uploadStarted.resolve();
      return upload.promise;
    });
    const runtime = createActionWorkflowRuntime(fixture.ports);
    const pending = runtime.submit({
      selectionSessionId: 1,
      pngBuffer: PNG,
      intentAnalysis: INTENT,
      isCurrent: () => true,
    });

    await uploadStarted.promise;
    fixture.invalidate();
    upload.resolve();

    await expect(pending).rejects.toThrow('action_workflow_cancelled');
    expect(fixture.ports.enqueueTask).not.toHaveBeenCalled();
    expect(fixture.ports.dispatchWebhook).not.toHaveBeenCalled();
  });

  it('restores encrypted state and produces the same idempotency key for a retry', async () => {
    const fixture = createFixture();
    fixture.setState({
      version: 1,
      supabaseUrl: SUPABASE_URL,
      deviceId: 'desktop-device-1',
      auth: { accessToken: 'old-access', refreshToken: 'old-refresh' },
      channelId: CHANNEL_ID,
    });
    const runtime = createActionWorkflowRuntime(fixture.ports);

    const first = await runtime.submit({
      selectionSessionId: 9,
      pngBuffer: PNG,
      intentAnalysis: INTENT,
      isCurrent: () => true,
    });
    const second = await runtime.submit({
      selectionSessionId: 9,
      pngBuffer: PNG,
      intentAnalysis: INTENT,
      isCurrent: () => true,
    });

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(fixture.ports.signInAnonymously).not.toHaveBeenCalled();
    expect(fixture.ports.createChannel).not.toHaveBeenCalled();
  });

  it('creates a channel invite for QR pairing without exposing auth tokens', async () => {
    const fixture = createFixture();
    const runtime = createActionWorkflowRuntime(fixture.ports);

    const pairing = await runtime.createPairingInvite();

    expect(pairing.channelId).toBe(CHANNEL_ID);
    expect(pairing.inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(pairing.inviteExpiresAt)).toBeGreaterThan(Date.now());
    expect(fixture.ports.createChannel).toHaveBeenCalledTimes(1);
    expect(fixture.ports.rotateChannelInvite).not.toHaveBeenCalled();
    expect(JSON.stringify(pairing)).not.toContain('access-token');
    expect(JSON.stringify(pairing)).not.toContain('refresh-token');
  });

  it('rotates an existing channel invite before generating a fresh QR payload', async () => {
    const fixture = createFixture();
    fixture.setState({
      version: 1,
      supabaseUrl: SUPABASE_URL,
      deviceId: 'desktop-device-1',
      auth: { accessToken: 'old-access', refreshToken: 'old-refresh' },
      channelId: CHANNEL_ID,
      inviteToken: 'old-invite',
      inviteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const runtime = createActionWorkflowRuntime(fixture.ports);

    const pairing = await runtime.createPairingInvite();

    expect(fixture.ports.createChannel).not.toHaveBeenCalled();
    expect(fixture.ports.rotateChannelInvite).toHaveBeenCalledWith(
      fixture.context,
      expect.objectContaining({
        channelId: CHANNEL_ID,
        inviteToken: pairing.inviteToken,
        inviteExpiresAt: pairing.inviteExpiresAt,
      })
    );
    expect(pairing.inviteToken).not.toBe('old-invite');
    expect(fixture.getState()?.inviteToken).toBe(pairing.inviteToken);
  });

  it('serializes QR pairing with a concurrent action submission', async () => {
    const fixture = createFixture();
    const channelCreated = deferred<string>();
    const channelStarted = deferred<void>();
    (fixture.ports.createChannel as jest.Mock).mockImplementationOnce(() => {
      channelStarted.resolve();
      return channelCreated.promise;
    });
    const runtime = createActionWorkflowRuntime(fixture.ports);

    const pairing = runtime.createPairingInvite();
    const submission = runtime.submit({
      selectionSessionId: 11,
      pngBuffer: PNG,
      intentAnalysis: INTENT,
      isCurrent: () => true,
    });
    await channelStarted.promise;
    expect(fixture.ports.enqueueTask).not.toHaveBeenCalled();

    channelCreated.resolve(CHANNEL_ID);
    await Promise.all([pairing, submission]);

    expect(fixture.ports.createChannel).toHaveBeenCalledTimes(1);
    expect(fixture.ports.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(fixture.ports.enqueueTask).toHaveBeenCalledTimes(1);
  });
});

describe('action webhook validation', () => {
  it('allows HTTPS and loopback HTTP only', () => {
    expect(
      validateActionWebhookConfig({ url: 'https://n8n.example.test/hook', secret: SECRET }).url
    ).toBe('https://n8n.example.test/hook');
    expect(
      validateActionWebhookConfig({ url: 'http://localhost:5678/hook', secret: SECRET }).url
    ).toBe('http://localhost:5678/hook');
    expect(() =>
      validateActionWebhookConfig({ url: 'http://192.168.1.8/hook', secret: SECRET })
    ).toThrow('action_webhook_url_insecure');
  });

  it('rejects short secrets and embedded credentials', () => {
    expect(() =>
      validateActionWebhookConfig({ url: 'https://n8n.example.test/hook', secret: 'short' })
    ).toThrow('action_webhook_secret_missing_or_too_short');
    expect(() =>
      validateActionWebhookConfig({
        url: 'https://user:pass@n8n.example.test/hook',
        secret: SECRET,
      })
    ).toThrow('action_webhook_url_insecure');
  });
});
