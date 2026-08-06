import {
  buildRlsSetupSql,
  CLIPBOARD_CONTENT_MAX_LENGTH,
} from '../src/lib/supabaseSetup';

describe('buildRlsSetupSql', () => {
  it('embeds the bucket name in the update and all four policies', () => {
    const sql = buildRlsSetupSql('screenshots');
    expect(sql).toContain("update storage.buckets set public = false where name = 'screenshots'");
    expect(sql).toContain('ctrl2phone_select_screenshots');
    expect(sql).toContain('ctrl2phone_insert_screenshots');
    expect(sql).toContain('ctrl2phone_update_screenshots');
    expect(sql).toContain('ctrl2phone_delete_screenshots');
  });

  it('scopes the policies to anon and authenticated', () => {
    const sql = buildRlsSetupSql('screenshots');
    expect(sql).toContain('to anon, authenticated');
  });

  it('creates the complete clipboard table contract', () => {
    const sql = buildRlsSetupSql('screenshots');
    expect(sql).toContain('create table if not exists public.clipboard_sync');
    expect(sql).toContain('id uuid primary key default gen_random_uuid()');
    expect(sql).toContain('content text not null');
    expect(sql).toContain('source text not null');
    expect(sql).toContain('created_at timestamptz not null default now()');
    expect(sql).toContain(
      `check (char_length(content) between 1 and ${CLIPBOARD_CONTENT_MAX_LENGTH})`
    );
    expect(sql).toContain("check (source in ('desktop', 'mobile'))");
  });

  it('repairs missing clipboard columns and named constraints without dropping data', () => {
    const sql = buildRlsSetupSql('screenshots');
    expect(sql).toContain('alter table public.clipboard_sync add column if not exists id uuid');
    expect(sql).toContain("conname = 'ctrl2phone_clipboard_content_length'");
    expect(sql).toContain("conname = 'ctrl2phone_clipboard_source'");
    expect(sql).toContain("and contype = 'p'");
    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain('truncate table');
  });

  it('creates the polling index and enables RLS', () => {
    const sql = buildRlsSetupSql('screenshots');
    expect(sql).toContain('create index if not exists clipboard_sync_source_created_at_idx');
    expect(sql).toContain('on public.clipboard_sync (source, created_at asc)');
    expect(sql).toContain('alter table public.clipboard_sync enable row level security');
  });

  it('grants only the clipboard operations used by the clients', () => {
    const sql = buildRlsSetupSql('screenshots');
    expect(sql).toContain('revoke all on table public.clipboard_sync from anon, authenticated');
    expect(sql).toContain(
      'grant select, insert, delete on table public.clipboard_sync to anon, authenticated'
    );
    expect(sql).not.toContain('grant select, insert, update, delete on table public.clipboard_sync');
  });

  it('drops and recreates stable clipboard policy names idempotently', () => {
    const sql = buildRlsSetupSql('screenshots');
    for (const operation of ['select', 'insert', 'delete']) {
      const policyName = `ctrl2phone_clipboard_${operation}`;
      expect(sql).toContain(`drop policy if exists "${policyName}"`);
      expect(sql).toContain(`create policy "${policyName}"`);
    }
    expect(sql).not.toContain('ctrl2phone_clipboard_update');
    expect(sql).toContain("source in ('desktop', 'mobile')");
    expect(sql).toContain(
      `char_length(content) between 1 and ${CLIPBOARD_CONTENT_MAX_LENGTH}`
    );
  });

  it('enables Realtime non-fatally: grants select + adds storage.objects to the publication', () => {
    const sql = buildRlsSetupSql('screenshots');
    // anon needs a table GRANT (not just RLS) to receive Realtime on private storage schema
    expect(sql).toContain('grant select on storage.objects to anon, authenticated');
    expect(sql).toContain('alter publication supabase_realtime add table storage.objects');
    // Realtime steps must NOT roll back the security policies if they lack permission
    expect(sql).toContain('exception when others then');
  });

  it('defaults to "screenshots" for an empty bucket', () => {
    expect(buildRlsSetupSql('')).toContain("where name = 'screenshots'");
  });

  it('escapes single quotes in the SQL string literal', () => {
    const sql = buildRlsSetupSql("a'b");
    expect(sql).toContain("where name = 'a''b'");
  });

  it('sanitizes the policy identifier (strips spaces and symbols)', () => {
    const sql = buildRlsSetupSql('my shots!');
    // the sanitized name is reused across all four policy identifiers
    expect(sql).toContain('ctrl2phone_select_myshots');
    expect(sql).toContain('ctrl2phone_insert_myshots');
    expect(sql).toContain('ctrl2phone_update_myshots');
    expect(sql).toContain('ctrl2phone_delete_myshots');
    // but the bucket literal keeps the original characters
    expect(sql).toContain("where name = 'my shots!'");
  });

  it('escapes the quote before sanitizing the identifier', () => {
    const sql = buildRlsSetupSql("o'brien");
    expect(sql).toContain("where name = 'o''brien'"); // doubled quote in the literal
    expect(sql).toContain('ctrl2phone_select_obrien'); // quote stripped from the identifier
  });

  it('falls back to a non-empty identifier when the name sanitizes to empty', () => {
    const sql = buildRlsSetupSql('!!!');
    expect(sql).toContain('ctrl2phone_select_bucket');
    expect(sql).toContain("where name = '!!!'");
  });
});
