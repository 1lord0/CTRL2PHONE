export const ACTION_TASK_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const ACTION_TASK_TITLE_MAX_LENGTH = 160;
export const ACTION_TASK_SUMMARY_MAX_LENGTH = 20_000;

/**
 * Builds the task/result storage contract. Workflow-owned state and
 * mobile-user state live in separate tables so concurrent updates cannot
 * overwrite one another.
 */
export function buildActionTaskSetupSql(): string {
  return `create table if not exists public.action_tasks (
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
    check (char_length(idempotency_key) between 1 and ${ACTION_TASK_IDEMPOTENCY_KEY_MAX_LENGTH}),
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
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/act_[0-9a-f]{64}\\.png$'
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
    check (char_length(title) between 1 and ${ACTION_TASK_TITLE_MAX_LENGTH}),
  constraint ctrl2phone_action_task_summary_length
    check (summary is null or char_length(summary) <= ${ACTION_TASK_SUMMARY_MAX_LENGTH}),
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

  if char_length(coalesce(p_idempotency_key, '')) not between 1 and ${ACTION_TASK_IDEMPOTENCY_KEY_MAX_LENGTH}
     or coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(p_source_device_id, '')) not between 1 and 160
     or (p_source_storage_path is not null and char_length(p_source_storage_path) not between 1 and 1024)
     or (
       p_source_storage_path is not null
       and (
         p_source_storage_path !~
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/act_[0-9a-f]{64}\\.png$'
         or split_part(p_source_storage_path, '/', 1) <> p_channel_id::text
         or split_part(p_source_storage_path, '/', 2) <> p_idempotency_key || '.png'
       )
     )
     or char_length(coalesce(p_title, '')) not between 1 and ${ACTION_TASK_TITLE_MAX_LENGTH} then
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

drop function if exists public.advance_action_task CASCADE;

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
     or (p_title is not null and char_length(p_title) not between 1 and ${ACTION_TASK_TITLE_MAX_LENGTH})
     or (p_summary is not null and char_length(p_summary) > ${ACTION_TASK_SUMMARY_MAX_LENGTH})
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

alter table public.action_tasks add column if not exists sent_to_phone boolean not null default false;

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
`;
}
