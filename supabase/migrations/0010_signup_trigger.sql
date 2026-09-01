-- Wave 3.1: auth.users -> public.profiles signup trigger.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role, invited_by)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'display_name',
    coalesce(new.raw_user_meta_data ->> 'role', 'client')::public.user_role,
    nullif(new.raw_user_meta_data ->> 'invited_by', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT ON auth.users: seeds public.profiles from signup metadata (display_name, role default client, invited_by). ON CONFLICT DO NOTHING so a pre-seeded profile (coach accounts created manually) is never clobbered.';

-- Trigger-only function: no client role should ever call this directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
