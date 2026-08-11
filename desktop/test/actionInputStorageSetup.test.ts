import {
  ACTION_INPUT_BUCKET,
  ACTION_INPUT_MAX_BYTES,
  buildActionInputStorageSetupSql,
} from '../src/lib/actionInputStorageSetup';

describe('action input storage setup', () => {
  const sql = buildActionInputStorageSetupSql();

  it('creates a fixed private PNG-only bucket with a bounded file size', () => {
    expect(sql).toContain(`'${ACTION_INPUT_BUCKET}'`);
    expect(sql).toContain('false');
    expect(sql).toContain(String(ACTION_INPUT_MAX_BYTES));
    expect(sql).toContain("array['image/png']::text[]");
  });

  it('authorizes only authenticated channel owners on deterministic object paths', () => {
    expect(sql).toContain('public.can_manage_action_input');
    expect(sql).toContain('channel.owner_id = (select auth.uid())');
    expect(sql).toContain('/act_[0-9a-f]{64}\\.png');
    expect(sql).toContain('from public, anon');
    expect(sql).toContain('to authenticated');
  });

  it('defines select, insert, update and delete RLS without public object access', () => {
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toContain(`ctrl2phone_action_inputs_${operation}`);
    }
    expect(sql).not.toContain('to anon');
    expect(sql).not.toContain('public = true');
  });
});
