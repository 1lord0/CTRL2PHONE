export const ACTION_INPUT_BUCKET = 'ctrl2phone-action-inputs';
export const ACTION_INPUT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Creates the private source-image bucket used by desktop-started workflows.
 * Only the authenticated channel owner can manage objects below its channel
 * prefix. n8n uses the service-role key and therefore does not need a user
 * policy or a signed public URL.
 */
export function buildActionInputStorageSetupSql(): string {
  return `-- Private source images for Ctrl2Phone action workflows.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  '${ACTION_INPUT_BUCKET}',
  '${ACTION_INPUT_BUCKET}',
  false,
  ${ACTION_INPUT_MAX_BYTES},
  array['image/png']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_action_input(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $ctrl2phone$
  select case
    when coalesce(p_object_name, '') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/act_[0-9a-f]{64}\\.png$'
    then exists (
      select 1
      from public.action_channels as channel
      where channel.id = split_part(p_object_name, '/', 1)::uuid
        and channel.owner_id = (select auth.uid())
    )
    else false
  end;
$ctrl2phone$;

revoke all on function public.can_manage_action_input(text) from public, anon;
grant execute on function public.can_manage_action_input(text) to authenticated;

drop policy if exists "ctrl2phone_action_inputs_select" on storage.objects;
create policy "ctrl2phone_action_inputs_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = '${ACTION_INPUT_BUCKET}'
    and (select public.can_manage_action_input(name))
  );

drop policy if exists "ctrl2phone_action_inputs_insert" on storage.objects;
create policy "ctrl2phone_action_inputs_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = '${ACTION_INPUT_BUCKET}'
    and (select public.can_manage_action_input(name))
  );

drop policy if exists "ctrl2phone_action_inputs_update" on storage.objects;
create policy "ctrl2phone_action_inputs_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = '${ACTION_INPUT_BUCKET}'
    and (select public.can_manage_action_input(name))
  )
  with check (
    bucket_id = '${ACTION_INPUT_BUCKET}'
    and (select public.can_manage_action_input(name))
  );

drop policy if exists "ctrl2phone_action_inputs_delete" on storage.objects;
create policy "ctrl2phone_action_inputs_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = '${ACTION_INPUT_BUCKET}'
    and (select public.can_manage_action_input(name))
  );
`;
}
