import { randomBytes } from 'node:crypto';

export const ACTION_CHANNEL_INVITE_BYTES = 32;
export const ACTION_CHANNEL_INVITE_TTL_MS = 10 * 60 * 1000;

export interface ActionChannelInvite {
  token: string;
  expiresAt: string;
}

export interface ActionChannelInvitePorts {
  randomBytes(size: number): Buffer;
  now(): Date;
}

const defaultPorts: ActionChannelInvitePorts = {
  randomBytes,
  now: () => new Date(),
};

export function createActionChannelInvite(
  ports: ActionChannelInvitePorts = defaultPorts
): ActionChannelInvite {
  const bytes = ports.randomBytes(ACTION_CHANNEL_INVITE_BYTES);
  if (bytes.length !== ACTION_CHANNEL_INVITE_BYTES) {
    throw new Error('action_channel_invite_random_source_failed');
  }

  const now = ports.now();
  if (!Number.isFinite(now.getTime())) {
    throw new Error('action_channel_invite_clock_failed');
  }

  return {
    token: bytes.toString('base64url'),
    expiresAt: new Date(now.getTime() + ACTION_CHANNEL_INVITE_TTL_MS).toISOString(),
  };
}
