-- Coach-managed client accounts: invite state, and disable only through the
-- manage-client Edge Function.
--
-- Disabling a client is two writes that must agree: profiles.disabled (what the
-- app displays and what the reminder cron filters on) and the auth ban (what
-- actually stops a login or a token refresh). A coach flipping the flag
-- directly would leave the two apart, so the flag becomes service-role only.

-- ---------------------------------------------------------------------------
-- Invite state
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column invited_at timestamptz,
  add column invite_accepted_at timestamptz;

comment on column public.profiles.invited_at is
  'Set when the account was created by an emailed invite (auth.users.invited_at). NULL for accounts created with a coach-set password or out of band. Pending = invited_at set and invite_accepted_at NULL.';

comment on column public.profiles.invite_accepted_at is
  'Stamped when the invited user first confirms their email (opens the invite link). NULL while the invite is still pending.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role, invited_by, invited_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'display_name',
    coalesce(new.raw_user_meta_data ->> 'role', 'client')::public.user_role,
    nullif(new.raw_user_meta_data ->> 'invited_by', '')::uuid,
    new.invited_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT ON auth.users: seeds public.profiles from signup metadata (display_name, role default client, invited_by) and auth.users.invited_at. ON CONFLICT DO NOTHING so a pre-seeded profile (coach accounts created manually) is never clobbered. Accounts are created only by the manage-client Edge Function; self-signup is off.';

create function public.handle_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set invite_accepted_at = now()
  where id = new.id
    and invited_at is not null
    and invite_accepted_at is null;
  return new;
end;
$$;

comment on function public.handle_invite_accepted() is
  'AFTER UPDATE OF email_confirmed_at ON auth.users: stamps profiles.invite_accepted_at the first time an invited user confirms.';

revoke execute on function public.handle_invite_accepted() from public, anon, authenticated;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_invite_accepted();

-- ---------------------------------------------------------------------------
-- disabled is written by the Edge Function only
-- ---------------------------------------------------------------------------

create or replace function public.prevent_profile_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Any signed-in caller (the client themself or their coach) is blocked from
  -- the flag; the service role and migrations have no auth.uid().
  if auth.uid() is not null and new.disabled is distinct from old.disabled then
    raise exception 'disabled can only be changed through manage-client';
  end if;

  if auth.uid() = new.id and (
    new.role is distinct from old.role
    or new.invited_by is distinct from old.invited_by
    or new.move_approval is distinct from old.move_approval
    or new.invited_at is distinct from old.invited_at
    or new.invite_accepted_at is distinct from old.invite_accepted_at
  ) then
    raise exception 'cannot change role, invited_by, move_approval, or invite state on your own profile';
  end if;
  return new;
end;
$$;

comment on function public.prevent_profile_privilege_change() is
  'Blocks privilege escalation on profiles. Nobody signed in can change disabled (it must stay in step with the auth ban, so only the manage-client Edge Function writes it). A client also cannot change their own role, invited_by, move_approval or invite state; coach-driven updates to other columns of a client row are unaffected.';

revoke execute on function public.prevent_profile_privilege_change() from public, anon, authenticated;
