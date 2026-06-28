/**
 * Build the one-time RLS / private-bucket setup SQL for the user's bucket. It is
 * meant to be run once in the Supabase SQL Editor (which executes as the
 * privileged owner role) — the app's anon key cannot create policies by design.
 *
 * Pure string builder so it can be unit-tested without Electron.
 */
export function buildRlsSetupSql(bucketRaw: string): string {
  const bucket = (bucketRaw || 'screenshots').replace(/'/g, "''");
  // Sanitize for the policy identifier; fall back to a literal so an all-symbol
  // bucket can't collapse all four policy names to an empty (colliding) suffix.
  const name = bucket.replace(/[^a-zA-Z0-9._-]/g, '') || 'bucket';
  return `-- Ctrl2Phone — Supabase güvenlik kurulumu (tek seferlik)
-- Supabase Dashboard > SQL Editor'da bir kez "Run" deyin. Bucket: '${bucket}'

-- 1) Bucket'ı gizli yap: objeler artık herkese açık URL ile okunamaz.
update storage.buckets set public = false where name = '${bucket}';

-- 2) anon (ve ileride auth) rolünü SADECE bu bucket ile sınırla. Uygulama anon
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

-- 3) Realtime (BEST-EFFORT): telefon<->PC senkronu 4sn poll yerine anında olsun.
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
