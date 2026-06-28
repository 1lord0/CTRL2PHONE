import { buildRlsSetupSql } from '../src/lib/supabaseSetup';

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
