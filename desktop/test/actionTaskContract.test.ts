import {
  ACTION_TASK_STATUSES,
  buildActionTaskIdempotencyKey,
  isActionTaskTransitionAllowed,
} from '../src/lib/actionTaskContract';
import { buildActionTaskSetupSql } from '../src/lib/actionTaskSetup';
import { buildRlsSetupSql } from '../src/lib/supabaseSetup';

describe('action task contract', () => {
  it('allows only forward, non-terminal workflow transitions', () => {
    expect(isActionTaskTransitionAllowed('queued', 'analyzing')).toBe(true);
    expect(isActionTaskTransitionAllowed('analyzing', 'researching')).toBe(true);
    expect(isActionTaskTransitionAllowed('researching', 'completed')).toBe(true);
    expect(isActionTaskTransitionAllowed('analyzing', 'completed')).toBe(true);
    expect(isActionTaskTransitionAllowed('researching', 'analyzing')).toBe(false);
    for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
      for (const next of ACTION_TASK_STATUSES) {
        expect(isActionTaskTransitionAllowed(terminal, next)).toBe(false);
      }
    }
  });

  it('builds one deterministic key for repeated clicks in the same selection session', () => {
    const input = {
      channelId: 'channel-1',
      selectionSessionId: 'selection-9',
      actionType: 'intent-analysis',
      sourceDigest: 'a'.repeat(64),
    };
    const first = buildActionTaskIdempotencyKey(input);
    const second = buildActionTaskIdempotencyKey({ ...input });
    expect(first).toBe(second);
    expect(first).toMatch(/^act_[0-9a-f]{64}$/);
    expect(
      buildActionTaskIdempotencyKey({ ...input, selectionSessionId: 'selection-10' })
    ).not.toBe(first);
  });

  it('rejects malformed source digests before network I/O', () => {
    expect(() =>
      buildActionTaskIdempotencyKey({
        channelId: 'channel-1',
        selectionSessionId: 'selection-9',
        actionType: 'intent-analysis',
        sourceDigest: 'not-a-sha256',
      })
    ).toThrow('action_task_source_digest_invalid');
  });

  it('creates separate workflow and mobile-user-state tables', () => {
    const sql = buildActionTaskSetupSql();
    expect(sql).toContain('create table if not exists public.action_tasks');
    expect(sql).toContain('create table if not exists public.action_task_user_state');
    expect(sql).toContain('primary key (task_id, user_id)');
  });

  it('deduplicates enqueue atomically by channel and idempotency key', () => {
    const sql = buildActionTaskSetupSql();
    expect(sql).toContain('unique (channel_id, idempotency_key)');
    expect(sql).toContain('on conflict (channel_id, idempotency_key) do nothing');
    expect(sql).toContain('and task.request_hash = p_request_hash');
    expect(sql).toContain('action_task_idempotency_conflict');
    expect(sql).toContain('action_channel_owner_required');
  });

  it('uses optimistic versioning and monotonic progress for workflow updates', () => {
    const sql = buildActionTaskSetupSql();
    expect(sql).toContain('and task.version = p_expected_version');
    expect(sql).toContain('version = task.version + 1');
    expect(sql).toContain('and p_progress >= task.progress');
    expect(sql).toContain('action_task_version_or_transition_conflict');
  });

  it('prevents mobile clients from writing workflow-owned rows', () => {
    const sql = buildActionTaskSetupSql();
    expect(sql).toContain(
      'revoke all on table public.action_tasks from public, anon, authenticated'
    );
    expect(sql).toContain('grant select on table public.action_tasks to authenticated');
    expect(sql).not.toContain('grant insert on table public.action_tasks to authenticated');
    expect(sql).toContain(') to service_role;');
  });

  it('scopes mobile state to auth.uid without touching the workflow row', () => {
    const sql = buildActionTaskSetupSql();
    expect(sql).toContain('user_id = (select auth.uid())');
    expect(sql).toContain('on conflict (task_id, user_id) do update');
    const stateFunction = sql.slice(sql.indexOf('public.set_action_task_user_state'));
    expect(stateFunction).not.toContain('update public.action_tasks');
  });

  it('publishes both tables to Realtime idempotently and non-fatally', () => {
    const sql = buildActionTaskSetupSql();
    expect(sql).toContain('alter publication supabase_realtime add table public.action_tasks');
    expect(sql).toContain(
      'alter publication supabase_realtime add table public.action_task_user_state'
    );
    expect(sql.match(/exception when others then/g)?.length).toBe(2);
  });

  it('is embedded after channel setup in the generated Supabase SQL', () => {
    const sql = buildRlsSetupSql('screenshots');
    expect(sql.indexOf('create table if not exists public.action_channels')).toBeLessThan(
      sql.indexOf('create table if not exists public.action_tasks')
    );
  });
});
