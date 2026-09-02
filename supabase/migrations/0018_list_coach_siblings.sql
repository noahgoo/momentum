-- Clients can't read sibling clients under profiles RLS (by design), which
-- leaves the friends "find friends" roster empty. Expose the minimal fields
-- needed to send a friend request via a SECURITY DEFINER RPC instead of
-- widening the profiles SELECT policy (pattern: my_coach_id in 0017).

create or replace function public.list_coach_siblings()
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name
  from public.profiles p
  where p.invited_by = (select invited_by from public.profiles where id = auth.uid())
    and p.invited_by is not null
    and p.id <> auth.uid()
    and p.role = 'client'
    and p.disabled = false
  order by p.display_name;
$$;

revoke execute on function public.list_coach_siblings() from public, anon;
grant execute on function public.list_coach_siblings() to authenticated;
