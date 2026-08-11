/**
 * Builds the idempotent Supabase SQL used to pair one desktop installation with
 * one or more authenticated mobile installations. Pairing tokens are stored as
 * SHA-256 digests and are invalidated by the first successful claim.
 */
export function buildActionChannelSetupSql(): string {
  return `-- Ctrl2Phone action channel pairing.
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

create or replace function public.claim_action_channel_invite(
  p_channel_id uuid,
  p_invite_token text
)
returns uuid
language sql
security definer
set search_path = ''
as $ctrl2phone$
  select public.claim_action_channel(p_channel_id, p_invite_token);
$ctrl2phone$;

revoke all on function public.is_action_channel_member(uuid) from public, anon;
revoke all on function public.create_action_channel(text, text, timestamptz) from public, anon;
revoke all on function public.claim_action_channel(uuid, text) from public, anon;
revoke all on function public.claim_action_channel_invite(uuid, text) from public, anon;
revoke all on function public.rotate_action_channel_invite(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.is_action_channel_member(uuid) to authenticated;
grant execute on function public.create_action_channel(text, text, timestamptz) to authenticated;
grant execute on function public.claim_action_channel(uuid, text) to authenticated;
grant execute on function public.claim_action_channel_invite(uuid, text) to authenticated;
grant execute on function public.rotate_action_channel_invite(uuid, text, timestamptz)
  to authenticated;
`;
}
