-- Ctrl2Phone — Supabase güvenlik kurulumu (tek seferlik)
-- Supabase Dashboard > SQL Editor'da bir kez "Run" deyin. Bucket: 'screenshots'

-- 1) Universal Clipboard tablosu. Bu bölüm tekrar çalıştırılabilir ve mevcut
--    satırları silmez. Metin sınırı masaüstü ve mobil istemcilerle aynıdır.
create table if not exists public.clipboard_sync (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint ctrl2phone_clipboard_content_length
    check (char_length(content) between 1 and 10000),
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
      check (char_length(content) between 1 and 10000);
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
    and char_length(content) between 1 and 10000
  );

drop policy if exists "ctrl2phone_clipboard_delete" on public.clipboard_sync;
create policy "ctrl2phone_clipboard_delete" on public.clipboard_sync
  for delete to anon, authenticated using (true);

-- Ctrl2Phone action channel pairing.
-- Anonymous Supabase Auth users receive the authenticated database role. The
-- bare anon API key is intentionally denied access to these tables/functions.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.action_channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Ctrl2Phone',
  invite_token_hash bytea,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ctrl2phone_action_channel_name_length
    check (char_length(name) between 1 and 80),
  constraint ctrl2phone_action_channel_invite_pair
    check ((invite_token_hash is null) = (invite_expires_at is null)),
  constraint ctrl2phone_action_channel_invite_hash_length
    check (invite_token_hash is null or octet_length(invite_token_hash) = 32)
);

create table if not exists public.action_channel_members (
  channel_id uuid not null references public.action_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id),
  constraint ctrl2phone_action_channel_member_role
    check (role in ('owner', 'member'))
);

create index if not exists action_channels_owner_id_idx
  on public.action_channels (owner_id);
create index if not exists action_channel_members_user_id_idx
  on public.action_channel_members (user_id, channel_id);

alter table public.action_channels enable row level security;
alter table public.action_channel_members enable row level security;

revoke all on table public.action_channels from public, anon, authenticated;
revoke all on table public.action_channel_members from public, anon, authenticated;
grant select on table public.action_channels to authenticated;
grant select on table public.action_channel_members to authenticated;
grant select, insert, update, delete on table public.action_channels to service_role;
grant select, insert, update, delete on table public.action_channel_members to service_role;

create or replace function public.is_action_channel_member(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $ctrl2phone$
  select exists (
    select 1
    from public.action_channel_members as member
    where member.channel_id = p_channel_id
      and member.user_id = (select auth.uid())
  );
$ctrl2phone$;

drop policy if exists "ctrl2phone_action_channels_select" on public.action_channels;
create policy "ctrl2phone_action_channels_select" on public.action_channels
  for select to authenticated
  using ((select public.is_action_channel_member(id)));

drop policy if exists "ctrl2phone_action_channel_members_select"
  on public.action_channel_members;
create policy "ctrl2phone_action_channel_members_select"
  on public.action_channel_members
  for select to authenticated
  using ((select public.is_action_channel_member(channel_id)));

create or replace function public.create_action_channel(
  p_name text,
  p_invite_token text,
  p_invite_expires_at timestamptz default (now() + interval '10 minutes')
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $ctrl2phone$
declare
  caller_id uuid := auth.uid();
  channel_id uuid;
  token_size integer := octet_length(convert_to(coalesce(p_invite_token, ''), 'UTF8'));
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if token_size < 32 or token_size > 256 then
    raise exception using errcode = '22023', message = 'invalid_action_channel_invite';
  end if;

  if p_invite_expires_at <= now()
     or p_invite_expires_at > now() + interval '30 minutes' then
    raise exception using errcode = '22023', message = 'invalid_action_channel_invite_expiry';
  end if;

  insert into public.action_channels (
    owner_id,
    name,
    invite_token_hash,
    invite_expires_at
  ) values (
    caller_id,
    coalesce(nullif(btrim(p_name), ''), 'Ctrl2Phone'),
    extensions.digest(convert_to(p_invite_token, 'UTF8'), 'sha256'),
    p_invite_expires_at
  )
  returning id into channel_id;

  insert into public.action_channel_members (channel_id, user_id, role)
  values (channel_id, caller_id, 'owner');

  return channel_id;
end;
$ctrl2phone$;

create or replace function public.claim_action_channel(
  p_channel_id uuid,
  p_invite_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $ctrl2phone$
declare
  caller_id uuid := auth.uid();
  stored_hash bytea;
  expires_at timestamptz;
  token_size integer := octet_length(convert_to(coalesce(p_invite_token, ''), 'UTF8'));
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if token_size < 32 or token_size > 256 then
    raise exception using errcode = 'P0001', message = 'invalid_or_expired_action_channel_invite';
  end if;

  select invite_token_hash, invite_expires_at
    into stored_hash, expires_at
  from public.action_channels
  where id = p_channel_id
  for update;

  if not found
     or stored_hash is null
     or expires_at is null
     or expires_at <= now()
     or stored_hash <> extensions.digest(convert_to(p_invite_token, 'UTF8'), 'sha256') then
    raise exception using errcode = 'P0001', message = 'invalid_or_expired_action_channel_invite';
  end if;

  insert into public.action_channel_members (channel_id, user_id, role)
  values (p_channel_id, caller_id, 'member')
  on conflict (channel_id, user_id) do nothing;

  update public.action_channels
  set invite_token_hash = null,
      invite_expires_at = null,
      updated_at = now()
  where id = p_channel_id;

  return p_channel_id;
end;
$ctrl2phone$;

create or replace function public.rotate_action_channel_invite(
  p_channel_id uuid,
  p_invite_token text,
  p_invite_expires_at timestamptz default (now() + interval '10 minutes')
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $ctrl2phone$
declare
  caller_id uuid := auth.uid();
  token_size integer := octet_length(convert_to(coalesce(p_invite_token, ''), 'UTF8'));
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if token_size < 32 or token_size > 256 then
    raise exception using errcode = '22023', message = 'invalid_action_channel_invite';
  end if;

  if p_invite_expires_at <= now()
     or p_invite_expires_at > now() + interval '30 minutes' then
    raise exception using errcode = '22023', message = 'invalid_action_channel_invite_expiry';
  end if;

  update public.action_channels
  set invite_token_hash = extensions.digest(convert_to(p_invite_token, 'UTF8'), 'sha256'),
      invite_expires_at = p_invite_expires_at,
      updated_at = now()
  where id = p_channel_id
    and owner_id = caller_id;

  if not found then
    raise exception using errcode = '42501', message = 'action_channel_owner_required';
  end if;

  return p_channel_id;
end;
$ctrl2phone$;

revoke all on function public.is_action_channel_member(uuid) from public, anon;
revoke all on function public.create_action_channel(text, text, timestamptz) from public, anon;
revoke all on function public.claim_action_channel(uuid, text) from public, anon;
revoke all on function public.rotate_action_channel_invite(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.is_action_channel_member(uuid) to authenticated;
grant execute on function public.create_action_channel(text, text, timestamptz) to authenticated;
grant execute on function public.claim_action_channel(uuid, text) to authenticated;
grant execute on function public.rotate_action_channel_invite(uuid, text, timestamptz)
  to authenticated;


-- Ctrl2Phone action tasks and per-mobile user state.
create table if not exists public.action_tasks (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.action_channels(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  source_device_id text not null,
  source_storage_path text,
  intent_type text not null default 'pending',
  workflow_status text not null default 'queued',
  progress smallint not null default 0,
  title text not null default 'Yeni analiz',
  summary text,
  result_json jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  confidence numeric(5, 4),
  error_code text,
  error_message text,
  version bigint not null default 0,
  sent_to_phone boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ctrl2phone_action_task_idempotency_unique
    unique (channel_id, idempotency_key),
  constraint ctrl2phone_action_task_idempotency_length
    check (char_length(idempotency_key) between 1 and 128),
  constraint ctrl2phone_action_task_request_hash
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint ctrl2phone_action_task_source_device_length
    check (char_length(source_device_id) between 1 and 160),
  constraint ctrl2phone_action_task_source_path_length
    check (source_storage_path is null or char_length(source_storage_path) between 1 and 1024),
  constraint ctrl2phone_action_task_source_path_shape
    check (
      source_storage_path is null
      or source_storage_path ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/act_[0-9a-f]{64}\.png$'
    ),
  constraint ctrl2phone_action_task_intent
    check (intent_type in (
      'pending',
      'profile_research',
      'recipe_extraction',
      'general_visual_analysis'
    )),
  constraint ctrl2phone_action_task_status
    check (workflow_status in (
      'queued', 'analyzing', 'researching', 'completed', 'failed', 'cancelled'
    )),
  constraint ctrl2phone_action_task_progress
    check (progress between 0 and 100),
  constraint ctrl2phone_action_task_title_length
    check (char_length(title) between 1 and 160),
  constraint ctrl2phone_action_task_summary_length
    check (summary is null or char_length(summary) <= 20000),
  constraint ctrl2phone_action_task_result_object
    check (jsonb_typeof(result_json) = 'object'),
  constraint ctrl2phone_action_task_sources_array
    check (jsonb_typeof(sources) = 'array'),
  constraint ctrl2phone_action_task_confidence
    check (confidence is null or confidence between 0 and 1),
  constraint ctrl2phone_action_task_error_length
    check (
      (error_code is null or char_length(error_code) between 1 and 120)
      and (error_message is null or char_length(error_message) between 1 and 2000)
    ),
  constraint ctrl2phone_action_task_error_owner
    check (
      (workflow_status = 'failed' and error_code is not null)
      or (workflow_status <> 'failed' and error_code is null and error_message is null)
    ),
  constraint ctrl2phone_action_task_version
    check (version >= 0),
  constraint ctrl2phone_action_task_completion
    check (
      (
        workflow_status in ('completed', 'failed', 'cancelled')
        and completed_at is not null
      )
      or (
        workflow_status in ('queued', 'analyzing', 'researching')
        and completed_at is null
      )
    ),
  constraint ctrl2phone_action_task_completed_progress
    check (workflow_status <> 'completed' or progress = 100),
  constraint ctrl2phone_action_task_timestamps
    check (
      updated_at >= created_at
      and (completed_at is null or completed_at >= created_at)
    )
);

create table if not exists public.action_task_user_state (
  task_id uuid not null references public.action_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null references public.action_channels(id) on delete cascade,
  read_at timestamptz,
  pinned_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists action_tasks_channel_created_idx
  on public.action_tasks (channel_id, created_at desc, id desc);
create index if not exists action_tasks_channel_status_updated_idx
  on public.action_tasks (channel_id, workflow_status, updated_at desc);
create index if not exists action_task_user_state_inbox_idx
  on public.action_task_user_state (user_id, channel_id, archived_at, updated_at desc);

alter table public.action_tasks enable row level security;
alter table public.action_task_user_state enable row level security;

revoke all on table public.action_tasks from public, anon, authenticated;
revoke all on table public.action_task_user_state from public, anon, authenticated;
grant select on table public.action_tasks to authenticated;
grant select on table public.action_task_user_state to authenticated;
grant select, insert, update, delete on table public.action_tasks to service_role;
grant select, insert, update, delete on table public.action_task_user_state to service_role;

drop policy if exists "ctrl2phone_action_tasks_select" on public.action_tasks;
create policy "ctrl2phone_action_tasks_select" on public.action_tasks
  for select to authenticated
  using ((select public.is_action_channel_member(channel_id)));

drop policy if exists "ctrl2phone_action_task_user_state_select"
  on public.action_task_user_state;
create policy "ctrl2phone_action_task_user_state_select"
  on public.action_task_user_state
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_action_channel_member(channel_id))
  );

create or replace function public.is_action_task_transition_allowed(
  p_current text,
  p_next text
)
returns boolean
language sql
immutable
set search_path = ''
as $ctrl2phone$
  select case p_current
    when 'queued' then p_next in ('queued', 'analyzing', 'failed', 'cancelled')
    when 'analyzing' then p_next in (
      'analyzing', 'researching', 'completed', 'failed', 'cancelled'
    )
    when 'researching' then p_next in (
      'researching', 'completed', 'failed', 'cancelled'
    )
    else false
  end;
$ctrl2phone$;

create or replace function public.enqueue_action_task(
  p_channel_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_source_device_id text,
  p_source_storage_path text default null,
  p_title text default 'Yeni analiz'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $ctrl2phone$
declare
  caller_id uuid := auth.uid();
  task_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if not exists (
    select 1
    from public.action_channels as channel
    where channel.id = p_channel_id
      and channel.owner_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'action_channel_owner_required';
  end if;

  if char_length(coalesce(p_idempotency_key, '')) not between 1 and 128
     or coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(p_source_device_id, '')) not between 1 and 160
     or (p_source_storage_path is not null and char_length(p_source_storage_path) not between 1 and 1024)
     or (
       p_source_storage_path is not null
       and (
         p_source_storage_path !~
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/act_[0-9a-f]{64}\.png$'
         or split_part(p_source_storage_path, '/', 1) <> p_channel_id::text
         or split_part(p_source_storage_path, '/', 2) <> p_idempotency_key || '.png'
       )
     )
     or char_length(coalesce(p_title, '')) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'invalid_action_task_request';
  end if;

  insert into public.action_tasks (
    channel_id,
    idempotency_key,
    request_hash,
    source_device_id,
    source_storage_path,
    title
  ) values (
    p_channel_id,
    p_idempotency_key,
    p_request_hash,
    p_source_device_id,
    p_source_storage_path,
    p_title
  )
  on conflict (channel_id, idempotency_key) do nothing
  returning id into task_id;

  if task_id is null then
    select task.id into task_id
    from public.action_tasks as task
    where task.channel_id = p_channel_id
      and task.idempotency_key = p_idempotency_key
      and task.request_hash = p_request_hash;

    if task_id is null then
      raise exception using
        errcode = '23505',
        message = 'action_task_idempotency_conflict';
    end if;
  end if;

  return task_id;
end;
$ctrl2phone$;

create or replace function public.advance_action_task(
  p_task_id uuid,
  p_expected_version bigint,
  p_next_status text,
  p_progress smallint,
  p_intent_type text default null,
  p_title text default null,
  p_summary text default null,
  p_result_json jsonb default null,
  p_sources jsonb default null,
  p_confidence numeric default null,
  p_error_code text default null,
  p_error_message text default null
)
returns public.action_tasks
language plpgsql
security definer
set search_path = ''
as $ctrl2phone$
declare
  updated_task public.action_tasks;
begin
  if p_expected_version < 0
     or p_next_status not in (
       'queued', 'analyzing', 'researching', 'completed', 'failed', 'cancelled'
     )
     or p_progress not between 0 and 100
     or (
       p_intent_type is not null
       and p_intent_type not in (
         'pending', 'profile_research', 'recipe_extraction', 'general_visual_analysis'
       )
     )
     or (p_title is not null and char_length(p_title) not between 1 and 160)
     or (p_summary is not null and char_length(p_summary) > 20000)
     or (p_result_json is not null and jsonb_typeof(p_result_json) <> 'object')
     or (p_sources is not null and jsonb_typeof(p_sources) <> 'array')
     or (p_confidence is not null and p_confidence not between 0 and 1)
     or (
       p_next_status = 'failed'
       and char_length(coalesce(p_error_code, '')) not between 1 and 120
     )
     or (p_error_message is not null and char_length(p_error_message) > 2000) then
    raise exception using errcode = '22023', message = 'invalid_action_task_update';
  end if;

  update public.action_tasks as task
  set workflow_status = p_next_status,
      progress = case when p_next_status = 'completed' then 100 else p_progress end,
      intent_type = coalesce(p_intent_type, task.intent_type),
      title = coalesce(p_title, task.title),
      summary = coalesce(p_summary, task.summary),
      result_json = coalesce(p_result_json, task.result_json),
      sources = coalesce(p_sources, task.sources),
      confidence = coalesce(p_confidence, task.confidence),
      error_code = case when p_next_status = 'failed' then p_error_code else null end,
      error_message = case when p_next_status = 'failed' then p_error_message else null end,
      version = task.version + 1,
      updated_at = now(),
      completed_at = case
        when p_next_status in ('completed', 'failed', 'cancelled') then now()
        else null
      end
  where task.id = p_task_id
    and task.version = p_expected_version
    and p_progress >= task.progress
    and public.is_action_task_transition_allowed(task.workflow_status, p_next_status)
  returning task.* into updated_task;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'action_task_version_or_transition_conflict';
  end if;

  return updated_task;
end;
$ctrl2phone$;

create or replace function public.set_action_task_user_state(
  p_task_id uuid,
  p_is_read boolean default null,
  p_is_pinned boolean default null,
  p_is_archived boolean default null
)
returns public.action_task_user_state
language plpgsql
security definer
set search_path = ''
as $ctrl2phone$
declare
  caller_id uuid := auth.uid();
  task_channel_id uuid;
  saved_state public.action_task_user_state;
  changed_at timestamptz := now();
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select task.channel_id into task_channel_id
  from public.action_tasks as task
  where task.id = p_task_id;

  if task_channel_id is null
     or not public.is_action_channel_member(task_channel_id) then
    raise exception using errcode = '42501', message = 'action_task_access_denied';
  end if;

  insert into public.action_task_user_state (
    task_id,
    user_id,
    channel_id,
    read_at,
    pinned_at,
    archived_at,
    updated_at
  ) values (
    p_task_id,
    caller_id,
    task_channel_id,
    case when p_is_read is true then changed_at else null end,
    case when p_is_pinned is true then changed_at else null end,
    case when p_is_archived is true then changed_at else null end,
    changed_at
  )
  on conflict (task_id, user_id) do update
  set read_at = case
        when p_is_read is null then action_task_user_state.read_at
        when p_is_read then coalesce(action_task_user_state.read_at, changed_at)
        else null
      end,
      pinned_at = case
        when p_is_pinned is null then action_task_user_state.pinned_at
        when p_is_pinned then coalesce(action_task_user_state.pinned_at, changed_at)
        else null
      end,
      archived_at = case
        when p_is_archived is null then action_task_user_state.archived_at
        when p_is_archived then coalesce(action_task_user_state.archived_at, changed_at)
        else null
      end,
      updated_at = changed_at
  returning action_task_user_state.* into saved_state;

  return saved_state;
end;
$ctrl2phone$;

revoke all on function public.is_action_task_transition_allowed(text, text)
  from public, anon, authenticated;
revoke all on function public.enqueue_action_task(uuid, text, text, text, text, text)
  from public, anon;
revoke all on function public.advance_action_task(
  uuid, bigint, text, smallint, text, text, text, jsonb, jsonb, numeric, text, text
) from public, anon, authenticated;
revoke all on function public.set_action_task_user_state(uuid, boolean, boolean, boolean)
  from public, anon;
grant execute on function public.enqueue_action_task(uuid, text, text, text, text, text)
  to authenticated;
grant execute on function public.advance_action_task(
  uuid, bigint, text, smallint, text, text, text, jsonb, jsonb, numeric, text, text
) to service_role;
grant execute on function public.set_action_task_user_state(uuid, boolean, boolean, boolean)
  to authenticated;

do $ctrl2phone_realtime$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'action_tasks'
  ) then
    alter publication supabase_realtime add table public.action_tasks;
  end if;
exception when others then
  raise notice 'Ctrl2Phone: action_tasks Realtime publication skipped (%).', sqlerrm;
end
$ctrl2phone_realtime$;

do $ctrl2phone_realtime$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'action_task_user_state'
  ) then
    alter publication supabase_realtime add table public.action_task_user_state;
  end if;
exception when others then
  raise notice 'Ctrl2Phone: action_task_user_state Realtime publication skipped (%).', sqlerrm;
end
$ctrl2phone_realtime$;


-- Private source images for Ctrl2Phone action workflows.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ctrl2phone-action-inputs',
  'ctrl2phone-action-inputs',
  false,
  15728640,
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
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/act_[0-9a-f]{64}\.png$'
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
    bucket_id = 'ctrl2phone-action-inputs'
    and (select public.can_manage_action_input(name))
  );

drop policy if exists "ctrl2phone_action_inputs_insert" on storage.objects;
create policy "ctrl2phone_action_inputs_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ctrl2phone-action-inputs'
    and (select public.can_manage_action_input(name))
  );

drop policy if exists "ctrl2phone_action_inputs_update" on storage.objects;
create policy "ctrl2phone_action_inputs_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'ctrl2phone-action-inputs'
    and (select public.can_manage_action_input(name))
  )
  with check (
    bucket_id = 'ctrl2phone-action-inputs'
    and (select public.can_manage_action_input(name))
  );

drop policy if exists "ctrl2phone_action_inputs_delete" on storage.objects;
create policy "ctrl2phone_action_inputs_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ctrl2phone-action-inputs'
    and (select public.can_manage_action_input(name))
  );


-- 2) Bucket'ı gizli yap: objeler artık herkese açık URL ile okunamaz.
update storage.buckets set public = false where name = 'screenshots';

-- 3) anon (ve ileride auth) rolünü SADECE bu bucket ile sınırla. Uygulama anon
--    key kullanır; bu politikalar olmadan gizli bucket'a erişemez. Yükleme
--    upsert kullandığı için select+update GEREKLİ — dördünü de bırakın.
--    Tekrar çalıştırılabilir.
drop policy if exists "ctrl2phone_select_screenshots" on storage.objects;
create policy "ctrl2phone_select_screenshots" on storage.objects
  for select to anon, authenticated using (bucket_id = 'screenshots');

drop policy if exists "ctrl2phone_insert_screenshots" on storage.objects;
create policy "ctrl2phone_insert_screenshots" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'screenshots');

drop policy if exists "ctrl2phone_update_screenshots" on storage.objects;
create policy "ctrl2phone_update_screenshots" on storage.objects
  for update to anon, authenticated using (bucket_id = 'screenshots') with check (bucket_id = 'screenshots');

drop policy if exists "ctrl2phone_delete_screenshots" on storage.objects;
create policy "ctrl2phone_delete_screenshots" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'screenshots');

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
