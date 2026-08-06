/**
 * Build the one-time RLS / private-bucket setup SQL for the user's bucket. It is
 * meant to be run once in the Supabase SQL Editor (which executes as the
 * privileged owner role) — the app's anon key cannot create policies by design.
 *
 * Pure string builder so it can be unit-tested without Electron.
 */
export const CLIPBOARD_CONTENT_MAX_LENGTH = 10_000;

export function buildRlsSetupSql(bucketRaw: string): string {
  const bucketValue = bucketRaw || 'screenshots';
  const bucket = bucketValue.replace(/'/g, "''");
  // Sanitize for the policy identifier; fall back to a literal so an all-symbol
  // bucket can't collapse all four policy names to an empty (colliding) suffix.
  const name = bucketValue.replace(/[^a-zA-Z0-9._-]/g, '') || 'bucket';
  return `-- Ctrl2Phone — Supabase güvenlik kurulumu (tek seferlik)
-- Supabase Dashboard > SQL Editor'da bir kez "Run" deyin. Bucket: '${bucket}'

-- 1) Universal Clipboard tablosu. Bu bölüm tekrar çalıştırılabilir ve mevcut
--    satırları silmez. Metin sınırı masaüstü ve mobil istemcilerle aynıdır.
create table if not exists public.clipboard_sync (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint ctrl2phone_clipboard_content_length
    check (char_length(content) between 1 and ${CLIPBOARD_CONTENT_MAX_LENGTH}),
  constraint ctrl2phone_clipboard_source
    check (source in ('desktop', 'mobile'))
);

alter table public.clipboard_sync add column if not exists id uuid;
alter table public.clipboard_sync add column if not exists content text;
alter table public.clipboard_sync add column if not exists source text;
alter table public.clipboard_sync add column if not exists created_at timestamptz;
alter table public.clipboard_sync alter column id set default gen_random_uuid();
alter table public.clipboard_sync alter column created_at set default now();
alter table public.clipboard_sync alter column id set not null;
alter table public.clipboard_sync alter column content set not null;
alter table public.clipboard_sync alter column source set not null;
alter table public.clipboard_sync alter column created_at set not null;

do $ctrl2phone$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clipboard_sync'::regclass
      and contype = 'p'
  ) then
    alter table public.clipboard_sync
      add constraint clipboard_sync_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clipboard_sync'::regclass
      and conname = 'ctrl2phone_clipboard_content_length'
  ) then
    alter table public.clipboard_sync
      add constraint ctrl2phone_clipboard_content_length
      check (char_length(content) between 1 and ${CLIPBOARD_CONTENT_MAX_LENGTH});
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clipboard_sync'::regclass
      and conname = 'ctrl2phone_clipboard_source'
  ) then
    alter table public.clipboard_sync
      add constraint ctrl2phone_clipboard_source
      check (source in ('desktop', 'mobile'));
  end if;
end
$ctrl2phone$;

create index if not exists clipboard_sync_source_created_at_idx
  on public.clipboard_sync (source, created_at asc);

alter table public.clipboard_sync enable row level security;
revoke all on table public.clipboard_sync from anon, authenticated;
grant select, insert, delete on table public.clipboard_sync to anon, authenticated;

drop policy if exists "ctrl2phone_clipboard_select" on public.clipboard_sync;
create policy "ctrl2phone_clipboard_select" on public.clipboard_sync
  for select to anon, authenticated using (true);

drop policy if exists "ctrl2phone_clipboard_insert" on public.clipboard_sync;
create policy "ctrl2phone_clipboard_insert" on public.clipboard_sync
  for insert to anon, authenticated with check (
    source in ('desktop', 'mobile')
    and char_length(content) between 1 and ${CLIPBOARD_CONTENT_MAX_LENGTH}
  );

drop policy if exists "ctrl2phone_clipboard_delete" on public.clipboard_sync;
create policy "ctrl2phone_clipboard_delete" on public.clipboard_sync
  for delete to anon, authenticated using (true);

-- 2) Bucket'ı gizli yap: objeler artık herkese açık URL ile okunamaz.
update storage.buckets set public = false where name = '${bucket}';

-- 3) anon (ve ileride auth) rolünü SADECE bu bucket ile sınırla. Uygulama anon
--    key kullanır; bu politikalar olmadan gizli bucket'a erişemez. Yükleme
--    upsert kullandığı için select+update GEREKLİ — dördünü de bırakın.
--    Tekrar çalıştırılabilir.
drop policy if exists "ctrl2phone_select_${name}" on storage.objects;
create policy "ctrl2phone_select_${name}" on storage.objects
  for select to anon, authenticated using (bucket_id = '${bucket}');

drop policy if exists "ctrl2phone_insert_${name}" on storage.objects;
create policy "ctrl2phone_insert_${name}" on storage.objects
  for insert to anon, authenticated with check (bucket_id = '${bucket}');

drop policy if exists "ctrl2phone_update_${name}" on storage.objects;
create policy "ctrl2phone_update_${name}" on storage.objects
  for update to anon, authenticated using (bucket_id = '${bucket}') with check (bucket_id = '${bucket}');

drop policy if exists "ctrl2phone_delete_${name}" on storage.objects;
create policy "ctrl2phone_delete_${name}" on storage.objects
  for delete to anon, authenticated using (bucket_id = '${bucket}');

-- 4) Realtime (BEST-EFFORT): telefon<->PC senkronu 4sn poll yerine anında olsun.
--    storage PRIVATE bir şema olduğu için Realtime'ın anon'a event verebilmesi
--    (a) tablo düzeyinde GRANT SELECT + (b) publication'a eklemeyi gerektirir.
--    Her iki adım da yetki ister; HATA ALIRSA güvenlik politikalarını ETKİLEMEDEN
--    atlanır (NOTICE basar). O durumda Dashboard > Database > Publications'tan
--    storage.objects'i elle aç — yine de 15sn yedek poll çalışmaya devam eder.
do $$
begin
  grant select on storage.objects to anon, authenticated;
exception when others then
  raise notice 'Ctrl2Phone: Realtime GRANT atlandı (%). Dashboard''dan elle ver.', sqlerrm;
end $$;

do $$
begin
  alter publication supabase_realtime add table storage.objects;
exception when others then
  raise notice 'Ctrl2Phone: Realtime publication atlandı (%). Dashboard > Publications''tan elle ekle.', sqlerrm;
end $$;
`;
}
