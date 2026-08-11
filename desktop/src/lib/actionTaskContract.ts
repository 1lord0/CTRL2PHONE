import { createHash } from 'node:crypto';

export const ACTION_TASK_STATUSES = [
  'queued',
  'analyzing',
  'researching',
  'completed',
  'failed',
  'cancelled',
] as const;

export type ActionTaskStatus = (typeof ACTION_TASK_STATUSES)[number];

const allowedTransitions: Readonly<Record<ActionTaskStatus, readonly ActionTaskStatus[]>> = {
  queued: ['queued', 'analyzing', 'failed', 'cancelled'],
  analyzing: ['analyzing', 'researching', 'completed', 'failed', 'cancelled'],
  researching: ['researching', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isActionTaskTransitionAllowed(
  current: ActionTaskStatus,
  next: ActionTaskStatus
): boolean {
  return allowedTransitions[current].includes(next);
}

export interface ActionTaskIdempotencyInput {
  channelId: string;
  selectionSessionId: string;
  actionType: string;
  sourceDigest: string;
}

function checkedPart(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new Error(`action_task_${name}_invalid`);
  }
  return normalized;
}

export function buildActionTaskIdempotencyKey(input: ActionTaskIdempotencyInput): string {
  const sourceDigest = input.sourceDigest.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sourceDigest)) {
    throw new Error('action_task_source_digest_invalid');
  }

  const canonical = [
    'ctrl2phone-action-v1',
    checkedPart('channel_id', input.channelId),
    checkedPart('selection_session_id', input.selectionSessionId),
    checkedPart('action_type', input.actionType),
    sourceDigest,
  ].join('\u0000');

  return `act_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
