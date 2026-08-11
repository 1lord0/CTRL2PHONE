import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionTaskSnapshot } from '../types';
import {
  createActionTaskMonitor,
  type ActionTaskMonitor,
  type ActionTaskMonitorPorts,
} from './actionTaskMonitor';

const ACTION_TASK_COLUMNS = [
  'id',
  'intent_type',
  'workflow_status',
  'progress',
  'title',
  'summary',
  'result_json',
  'sources',
  'confidence',
  'error_code',
  'error_message',
  'version',
  'updated_at',
  'completed_at',
].join(',');

export interface ElectronActionTaskContext {
  readonly client: SupabaseClient;
  readonly url: string;
}

export interface ElectronActionTaskSubscription {
  readonly client: SupabaseClient;
  readonly channel: ReturnType<SupabaseClient['channel']>;
}

export interface ElectronActionTaskMonitorDeps {
  getContext(): ElectronActionTaskContext | null;
  isContextCurrent(context: ElectronActionTaskContext): boolean;
  publish(task: ActionTaskSnapshot): void;
  warn(message: string, detail?: string): void;
  error(message: string, error: unknown): void;
}

export function createElectronActionTaskMonitor(
  deps: ElectronActionTaskMonitorDeps
): ActionTaskMonitor {
  let subscriptionSequence = 0;
  const ports: ActionTaskMonitorPorts<
    ElectronActionTaskContext,
    ElectronActionTaskSubscription,
    NodeJS.Timeout
  > = {
    getContext: deps.getContext,
    isContextCurrent: deps.isContextCurrent,
    fetchTask: async (context, taskId) => {
      const { data, error } = await context.client
        .from('action_tasks')
        .select(ACTION_TASK_COLUMNS)
        .eq('id', taskId)
        .maybeSingle();
      return { row: data, error: error?.message ?? null };
    },
    subscribe: (context, taskId, onRow, onSubscribed, onError) => {
      subscriptionSequence += 1;
      const channel = context.client
        .channel(`ctrl2phone-action-task-${subscriptionSequence}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'action_tasks',
            filter: `id=eq.${taskId}`,
          },
          (payload) => onRow(payload.new)
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onSubscribed();
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onError(status);
        });
      return { client: context.client, channel };
    },
    removeSubscription: async (subscription) => {
      await subscription.client.removeChannel(subscription.channel);
    },
    publish: deps.publish,
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer),
    warn: deps.warn,
    error: deps.error,
  };
  return createActionTaskMonitor(ports);
}
