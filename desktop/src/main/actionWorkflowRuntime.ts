import { createHash, randomUUID } from 'node:crypto';
import { createActionChannelInvite } from '../lib/actionChannelInvite';
import { parseActionIntentAnalysis, type ActionIntentAnalysis } from '../lib/actionIntentAnalyzer';
import { ACTION_INPUT_BUCKET, ACTION_INPUT_MAX_BYTES } from '../lib/actionInputStorageSetup';
import { buildActionTaskIdempotencyKey } from '../lib/actionTaskContract';

const ACTION_STATE_VERSION = 1 as const;
const WEBHOOK_SECRET_MIN_LENGTH = 32;

export interface ActionAuthSession {
  accessToken: string;
  refreshToken: string;
}

export interface PersistedActionWorkflowState {
  version: typeof ACTION_STATE_VERSION;
  supabaseUrl: string;
  deviceId: string;
  auth: ActionAuthSession;
  channelId?: string;
  inviteToken?: string;
  inviteExpiresAt?: string;
}

export interface ActionWorkflowStateStore {
  load(): PersistedActionWorkflowState | null;
  save(state: PersistedActionWorkflowState): void;
}

export interface ActionWorkflowSubmitInput {
  selectionSessionId: number;
  pngBuffer: Buffer;
  intentAnalysis: ActionIntentAnalysis;
  isCurrent(): boolean;
}

export interface ActionWorkflowDispatchResult {
  taskId: string;
  channelId: string;
  idempotencyKey: string;
  sourceStoragePath: string;
}

export interface ActionPairingInvite {
  channelId: string;
  inviteToken: string;
  inviteExpiresAt: string;
}

export interface ActionWorkflowWebhookRequest {
  url: string;
  secret: string;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface ActionWorkflowRuntimePorts<Context> {
  getConnection(): { context: Context; url: string } | null;
  isConnectionCurrent(context: Context): boolean;
  getWebhookConfig(): { url: string; secret: string };
  stateStore: ActionWorkflowStateStore;
  restoreSession(context: Context, auth: ActionAuthSession): Promise<ActionAuthSession | null>;
  signInAnonymously(context: Context): Promise<ActionAuthSession>;
  createChannel(
    context: Context,
    input: { name: string; inviteToken: string; inviteExpiresAt: string }
  ): Promise<string>;
  rotateChannelInvite(
    context: Context,
    input: { channelId: string; inviteToken: string; inviteExpiresAt: string }
  ): Promise<void>;
  uploadActionInput(
    context: Context,
    bucket: string,
    objectPath: string,
    pngBuffer: Buffer
  ): Promise<void>;
  enqueueTask(
    context: Context,
    input: {
      channelId: string;
      idempotencyKey: string;
      requestHash: string;
      sourceDeviceId: string;
      sourceStoragePath: string;
      title: string;
    }
  ): Promise<string>;
  dispatchWebhook(request: ActionWorkflowWebhookRequest): Promise<void>;
  generateDeviceId?(): string;
}

export interface ActionWorkflowRuntime {
  submit(input: ActionWorkflowSubmitInput): Promise<ActionWorkflowDispatchResult>;
  createPairingInvite(): Promise<ActionPairingInvite>;
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('action_supabase_url_invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('action_supabase_url_invalid');
  }
  return parsed.origin;
}

export function validateActionWebhookConfig(config: { url: string; secret: string }): {
  url: string;
  secret: string;
} {
  const secret = config.secret.trim();
  if (secret.length < WEBHOOK_SECRET_MIN_LENGTH || secret.length > 512) {
    throw new Error('action_webhook_secret_missing_or_too_short');
  }

  let parsed: URL;
  try {
    parsed = new URL(config.url.trim());
  } catch {
    throw new Error('action_webhook_url_invalid');
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const isSecure = parsed.protocol === 'https:';
  const isLoopbackHttp = parsed.protocol === 'http:' && loopbackHosts.has(parsed.hostname);
  if ((!isSecure && !isLoopbackHttp) || parsed.username || parsed.password || parsed.hash) {
    throw new Error('action_webhook_url_insecure');
  }
  return { url: parsed.toString(), secret };
}

function assertCurrent<Context>(
  context: Context,
  input: ActionWorkflowSubmitInput,
  ports: ActionWorkflowRuntimePorts<Context>
): void {
  if (!input.isCurrent() || !ports.isConnectionCurrent(context)) {
    throw new Error('action_workflow_cancelled');
  }
}

function validatePng(buffer: Buffer): void {
  if (buffer.length < 8 || buffer.length > ACTION_INPUT_MAX_BYTES) {
    throw new Error('action_input_size_invalid');
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('action_input_not_png');
  }
}

function createInitialState(supabaseUrl: string, deviceId: string): PersistedActionWorkflowState {
  return {
    version: ACTION_STATE_VERSION,
    supabaseUrl,
    deviceId,
    auth: { accessToken: '', refreshToken: '' },
  };
}

export function createActionWorkflowRuntime<Context>(
  ports: ActionWorkflowRuntimePorts<Context>
): ActionWorkflowRuntime {
  let operationTail: Promise<void> = Promise.resolve();

  const runSerialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const prepareChannel = async (
    guard: (context: Context) => void
  ): Promise<{
    context: Context;
    state: PersistedActionWorkflowState;
    channelCreated: boolean;
  }> => {
    const connection = ports.getConnection();
    if (!connection) throw new Error('action_supabase_settings_missing');
    const supabaseUrl = normalizeOrigin(connection.url);
    const context = connection.context;
    guard(context);

    const loaded = ports.stateStore.load();
    let state =
      loaded?.version === ACTION_STATE_VERSION && loaded.supabaseUrl === supabaseUrl
        ? loaded
        : createInitialState(supabaseUrl, (ports.generateDeviceId ?? randomUUID)());

    let auth: ActionAuthSession | null = null;
    if (state.auth.accessToken && state.auth.refreshToken) {
      auth = await ports.restoreSession(context, state.auth);
    }
    if (!auth) {
      auth = await ports.signInAnonymously(context);
      state = {
        ...state,
        auth,
        channelId: undefined,
        inviteToken: undefined,
        inviteExpiresAt: undefined,
      };
    } else {
      state = { ...state, auth };
    }
    ports.stateStore.save(state);
    guard(context);

    let channelCreated = false;
    if (!state.channelId) {
      const invite = createActionChannelInvite();
      const channelId = await ports.createChannel(context, {
        name: 'Ctrl2Phone',
        inviteToken: invite.token,
        inviteExpiresAt: invite.expiresAt,
      });
      state = {
        ...state,
        channelId,
        inviteToken: invite.token,
        inviteExpiresAt: invite.expiresAt,
      };
      ports.stateStore.save(state);
      channelCreated = true;
    }
    guard(context);
    if (!state.channelId) throw new Error('action_channel_creation_failed');
    return { context, state, channelCreated };
  };

  const createPairingInvite = (): Promise<ActionPairingInvite> =>
    runSerialized(async () => {
      const guard = (context: Context): void => {
        if (!ports.isConnectionCurrent(context)) {
          throw new Error('action_workflow_cancelled');
        }
      };
      const prepared = await prepareChannel(guard);
      let state = prepared.state;

      if (!prepared.channelCreated) {
        const invite = createActionChannelInvite();
        await ports.rotateChannelInvite(prepared.context, {
          channelId: state.channelId!,
          inviteToken: invite.token,
          inviteExpiresAt: invite.expiresAt,
        });
        guard(prepared.context);
        state = {
          ...state,
          inviteToken: invite.token,
          inviteExpiresAt: invite.expiresAt,
        };
        ports.stateStore.save(state);
      }

      if (!state.channelId || !state.inviteToken || !state.inviteExpiresAt) {
        throw new Error('action_channel_invite_creation_failed');
      }
      return Object.freeze({
        channelId: state.channelId,
        inviteToken: state.inviteToken,
        inviteExpiresAt: state.inviteExpiresAt,
      });
    });

  const submit = (input: ActionWorkflowSubmitInput): Promise<ActionWorkflowDispatchResult> =>
    runSerialized(async () => {
      validatePng(input.pngBuffer);
      const intentAnalysis = parseActionIntentAnalysis(input.intentAnalysis);
      const webhook = validateActionWebhookConfig(ports.getWebhookConfig());
      const prepared = await prepareChannel((context) => assertCurrent(context, input, ports));
      const { context, state } = prepared;
      const channelId = state.channelId!;
      const sourceDigest = createHash('sha256').update(input.pngBuffer).digest('hex');
      const idempotencyKey = buildActionTaskIdempotencyKey({
        channelId,
        selectionSessionId: String(input.selectionSessionId),
        actionType: 'intent_analysis',
        sourceDigest,
      });
      const requestHash = createHash('sha256')
        .update(
          `ctrl2phone-action-request-v1\u0000${sourceDigest}\u0000${intentAnalysis.intentType}`,
          'utf8'
        )
        .digest('hex');
      const sourceStoragePath = `${channelId}/${idempotencyKey}.png`;

      await ports.uploadActionInput(
        context,
        ACTION_INPUT_BUCKET,
        sourceStoragePath,
        input.pngBuffer
      );
      assertCurrent(context, input, ports);
      const taskId = await ports.enqueueTask(context, {
        channelId,
        idempotencyKey,
        requestHash,
        sourceDeviceId: state.deviceId,
        sourceStoragePath,
        title: intentAnalysis.title,
      });
      assertCurrent(context, input, ports);

      await ports.dispatchWebhook({
        ...webhook,
        idempotencyKey,
        payload: Object.freeze({
          schemaVersion: 1,
          taskId,
          channelId,
          idempotencyKey,
          requestHash,
          expectedVersion: 0,
          intentAnalysis: Object.freeze({
            ...intentAnalysis,
            searchQueries: Object.freeze([...intentAnalysis.searchQueries]),
            visibleText: Object.freeze([...intentAnalysis.visibleText]),
          }),
          source: Object.freeze({
            bucket: ACTION_INPUT_BUCKET,
            objectPath: sourceStoragePath,
            mimeType: 'image/png',
            byteLength: input.pngBuffer.length,
            sha256: sourceDigest,
          }),
        }),
      });
      assertCurrent(context, input, ports);

      return { taskId, channelId, idempotencyKey, sourceStoragePath };
    });

  return { submit, createPairingInvite };
}
