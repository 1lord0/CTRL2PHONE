import type {
  ActionTaskIntentType,
  ActionTaskSnapshot,
  ActionTaskSource,
  ActionTaskWorkflowStatus,
} from '../types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_STATUSES = new Set<ActionTaskWorkflowStatus>([
  'queued',
  'analyzing',
  'researching',
  'completed',
  'failed',
  'cancelled',
]);
const INTENT_TYPES = new Set<ActionTaskIntentType>([
  'pending',
  'profile_research',
  'recipe_extraction',
  'general_visual_analysis',
]);
const TERMINAL_STATUSES = new Set<ActionTaskWorkflowStatus>(['completed', 'failed', 'cancelled']);
const MAX_RESULT_JSON_BYTES = 100_000;
const POLL_INTERVAL_MS = 5_000;

function optionalString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error('action_task_row_invalid');
  }
  return value;
}

function requiredString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    throw new Error('action_task_row_invalid');
  }
  return value;
}

function parseResultJson(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('action_task_row_invalid');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_JSON_BYTES) {
    throw new Error('action_task_result_too_large');
  }
  return Object.freeze(JSON.parse(serialized) as Record<string, unknown>);
}

function parseSources(value: unknown): readonly ActionTaskSource[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error('action_task_row_invalid');
  }
  return Object.freeze(
    value.map((source) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('action_task_row_invalid');
      }
      const title = requiredString((source as Record<string, unknown>).title, 300);
      const url = requiredString((source as Record<string, unknown>).url, 2048);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('action_task_row_invalid');
      }
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new Error('action_task_row_invalid');
      }
      return Object.freeze({ title, url: parsed.toString() });
    })
  );
}

export function parseActionTaskRow(row: unknown): ActionTaskSnapshot {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('action_task_row_invalid');
  }
  const value = row as Record<string, unknown>;
  const id = requiredString(value.id, 36);
  if (!UUID_PATTERN.test(id)) throw new Error('action_task_row_invalid');

  const workflowStatus = value.workflow_status as ActionTaskWorkflowStatus;
  const intentType = value.intent_type as ActionTaskIntentType;
  const progress = Number(value.progress);
  const version = Number(value.version);
  if (
    !TASK_STATUSES.has(workflowStatus) ||
    !INTENT_TYPES.has(intentType) ||
    !Number.isSafeInteger(progress) ||
    progress < 0 ||
    progress > 100 ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    throw new Error('action_task_row_invalid');
  }

  const confidence = value.confidence === null ? null : Number(value.confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new Error('action_task_row_invalid');
  }

  return Object.freeze({
    id,
    intentType,
    workflowStatus,
    progress,
    title: requiredString(value.title, 160),
    summary: optionalString(value.summary, 20_000),
    resultJson: parseResultJson(value.result_json),
    sources: parseSources(value.sources),
    confidence,
    errorCode: optionalString(value.error_code, 120),
    errorMessage: optionalString(value.error_message, 2_000),
    version,
    sentToPhone: Boolean(value.sent_to_phone),
    updatedAt: requiredString(value.updated_at, 80),
    completedAt: optionalString(value.completed_at, 80),
  });
}

export interface ActionTaskMonitorPorts<Context, Subscription, Timer> {
  getContext(): Context | null;
  isContextCurrent(context: Context): boolean;
  fetchTask(
    context: Context,
    taskId: string
  ): Promise<{ row: unknown | null; error: string | null }>;
  subscribe(
    context: Context,
    taskId: string,
    onRow: (row: unknown) => void,
    onSubscribed: () => void,
    onError: (message: string) => void
  ): Subscription;
  removeSubscription(subscription: Subscription): Promise<void>;
  publish(task: ActionTaskSnapshot): void;
  setInterval(callback: () => void, ms: number): Timer;
  clearInterval(timer: Timer): void;
  warn(message: string, detail?: string): void;
  error(message: string, error: unknown): void;
}

export interface ActionTaskMonitor {
  watch(taskId: string): Promise<boolean>;
  stopAndDrain(): Promise<void>;
}

interface WatchState<Context, Subscription, Timer> {
  readonly generation: number;
  readonly context: Context;
  readonly taskId: string;
  subscription: Subscription | null;
  timer: Timer | null;
  lastVersion: number;
  terminal: boolean;
  refreshPromise: Promise<void> | null;
  removePromise: Promise<void> | null;
}

export function createActionTaskMonitor<Context, Subscription, Timer>(
  ports: ActionTaskMonitorPorts<Context, Subscription, Timer>
): ActionTaskMonitor {
  let generation = 0;
  let current: WatchState<Context, Subscription, Timer> | null = null;
  let transitionTail: Promise<void> = Promise.resolve();

  const isCurrent = (state: WatchState<Context, Subscription, Timer>): boolean =>
    current === state && generation === state.generation && ports.isContextCurrent(state.context);

  const requestResourceCleanup = (
    state: WatchState<Context, Subscription, Timer>
  ): Promise<void> => {
    if (state.timer !== null) {
      ports.clearInterval(state.timer);
      state.timer = null;
    }
    if (state.subscription !== null && !state.removePromise) {
      const subscription = state.subscription;
      state.subscription = null;
      state.removePromise = ports.removeSubscription(subscription).catch((error: unknown) => {
        ports.error('Action task subscription teardown failed', error);
      });
    }
    return state.removePromise ?? Promise.resolve();
  };

  const cleanup = async (state: WatchState<Context, Subscription, Timer> | null): Promise<void> => {
    if (!state) return;
    await requestResourceCleanup(state);
    await state.refreshPromise;
  };

  const applyRow = (state: WatchState<Context, Subscription, Timer>, row: unknown): void => {
    if (!isCurrent(state) || state.terminal) return;
    let task: ActionTaskSnapshot;
    try {
      task = parseActionTaskRow(row);
    } catch (error) {
      ports.error('Action task row validation failed', error);
      return;
    }
    if (task.id !== state.taskId || task.version <= state.lastVersion) return;
    state.lastVersion = task.version;
    ports.publish(task);
    if (TERMINAL_STATUSES.has(task.workflowStatus)) {
      state.terminal = true;
      void requestResourceCleanup(state);
    }
  };

  const refresh = (state: WatchState<Context, Subscription, Timer>): Promise<void> => {
    if (!isCurrent(state) || state.terminal) return Promise.resolve();
    if (state.refreshPromise) return state.refreshPromise;

    const pending = (async () => {
      try {
        const result = await ports.fetchTask(state.context, state.taskId);
        if (!isCurrent(state) || state.terminal) return;
        if (result.error) {
          ports.warn('Action task refresh failed', result.error);
          return;
        }
        if (result.row) applyRow(state, result.row);
      } catch (error) {
        ports.error('Action task refresh failed', error);
      }
    })();
    const tracked = pending.finally(() => {
      if (state.refreshPromise === tracked) state.refreshPromise = null;
    });
    state.refreshPromise = tracked;
    return tracked;
  };

  const enqueueTransition = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = transitionTail.then(operation, operation);
    transitionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const watch = (taskId: string): Promise<boolean> => {
    if (!UUID_PATTERN.test(taskId)) return Promise.reject(new Error('action_task_id_invalid'));
    const requestedGeneration = ++generation;
    return enqueueTransition(async () => {
      const previous = current;
      current = null;
      await cleanup(previous);
      if (requestedGeneration !== generation) return false;

      const context = ports.getContext();
      if (!context || !ports.isContextCurrent(context)) return false;
      const state: WatchState<Context, Subscription, Timer> = {
        generation: requestedGeneration,
        context,
        taskId,
        subscription: null,
        timer: null,
        lastVersion: -1,
        terminal: false,
        refreshPromise: null,
        removePromise: null,
      };
      current = state;
      state.subscription = ports.subscribe(
        context,
        taskId,
        (row) => applyRow(state, row),
        () => void refresh(state),
        (message) => ports.warn('Action task realtime warning', message)
      );
      state.timer = ports.setInterval(() => void refresh(state), POLL_INTERVAL_MS);
      await refresh(state);
      return isCurrent(state) || state.terminal;
    });
  };

  const stopAndDrain = (): Promise<void> => {
    generation += 1;
    return enqueueTransition(async () => {
      const previous = current;
      current = null;
      await cleanup(previous);
    });
  };

  return { watch, stopAndDrain };
}
