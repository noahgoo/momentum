-- profiles_select_own_coach subqueried profiles inside a profiles policy,
-- which re-triggers RLS on the same table: 42P17 infinite recursion for every
-- caller, making profiles unreadable through the API. Route the lookup through
-- a SECURITY DEFINER helper (bypasses RLS, safe: returns only the caller's own
-- invited_by).

create or replace function public.my_coach_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select invited_by from public.profiles where id = auth.uid();
$$;

revoke execute on function public.my_coach_id() from public, anon;
grant execute on function public.my_coach_id() to authenticated;

drop policy profiles_select_own_coach on public.profiles;
create policy profiles_select_own_coach on public.profiles
  for select using (id = public.my_coach_id());
