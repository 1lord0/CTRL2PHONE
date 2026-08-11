import {
  ACTION_CHANNEL_INVITE_BYTES,
  ACTION_CHANNEL_INVITE_TTL_MS,
  createActionChannelInvite,
} from '../src/lib/actionChannelInvite';
import { buildActionChannelSetupSql } from '../src/lib/actionChannelSetup';

describe('action channel pairing', () => {
  it('generates a deterministic 256-bit base64url invite with a short expiry', () => {
    const now = new Date('2026-08-07T10:00:00.000Z');
    const invite = createActionChannelInvite({
      randomBytes: (size) => Buffer.alloc(size, 0xab),
      now: () => now,
    });

    expect(ACTION_CHANNEL_INVITE_BYTES).toBe(32);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.expiresAt).toBe(
      new Date(now.getTime() + ACTION_CHANNEL_INVITE_TTL_MS).toISOString()
    );
  });

  it('fails closed when the random source returns fewer bytes', () => {
    expect(() =>
      createActionChannelInvite({
        randomBytes: () => Buffer.alloc(31),
        now: () => new Date(),
      })
    ).toThrow('action_channel_invite_random_source_failed');
  });

  it('creates channel and membership tables with RLS enabled', () => {
    const sql = buildActionChannelSetupSql();
    expect(sql).toContain('create table if not exists public.action_channels');
    expect(sql).toContain('create table if not exists public.action_channel_members');
    expect(sql).toContain('alter table public.action_channels enable row level security');
    expect(sql).toContain('alter table public.action_channel_members enable row level security');
  });

  it('denies the bare anon key and grants authenticated users read-only table access', () => {
    const sql = buildActionChannelSetupSql();
    expect(sql).toContain(
      'revoke all on table public.action_channels from public, anon, authenticated'
    );
    expect(sql).toContain('grant select on table public.action_channels to authenticated');
    expect(sql).not.toContain(
      'grant select, insert, update, delete on table public.action_channels to authenticated'
    );
  });

  it('stores only a SHA-256 digest and consumes the invite exactly once', () => {
    const sql = buildActionChannelSetupSql();
    expect(sql).toContain("extensions.digest(convert_to(p_invite_token, 'UTF8'), 'sha256')");
    expect(sql).toContain('set invite_token_hash = null');
    expect(sql).toContain('invite_expires_at = null');
    expect(sql).not.toMatch(/^\s+invite_token text/m);
  });

  it('serializes claims and hides whether a channel or token was wrong', () => {
    const sql = buildActionChannelSetupSql();
    expect(sql).toContain('for update;');
    expect(sql.match(/invalid_or_expired_action_channel_invite/g)?.length).toBeGreaterThan(1);
    expect(sql).not.toContain('invalid_action_channel_id');
  });

  it('uses auth identity in security-definer functions with a locked search path', () => {
    const sql = buildActionChannelSetupSql();
    expect(sql).toContain('caller_id uuid := auth.uid()');
    expect(sql.match(/security definer/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain(
      'revoke all on function public.claim_action_channel(uuid, text) from public, anon'
    );
  });

  it('is embedded in the existing one-time Supabase setup SQL', async () => {
    const { buildRlsSetupSql } = await import('../src/lib/supabaseSetup');
    const sql = buildRlsSetupSql('screenshots');
    expect(sql).toContain('public.create_action_channel');
    expect(sql).toContain('public.claim_action_channel');
  });
});
