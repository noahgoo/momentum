-- ---------------------------------------------------------------------------
-- 0029: make sending a friend request actually possible.
--
-- `friendships_client_insert` gated the insert on this, evaluated as the
-- CALLER:
--
--   exists (select 1 from profiles a, profiles b
--           where a.id = client_id and b.id = friend_id
--             and a.invited_by = b.invited_by and coach_id = a.invited_by)
--
-- `profiles` has exactly three SELECT policies: your own row, rows you are the
-- coach of, and your coach's row. A SIBLING — another client of the same coach,
-- which is the only thing this feature ever inserts — matches none of them. So
-- `profiles b` returned zero rows, the EXISTS was false, and every request was
-- refused by RLS. The feature could not have worked for anyone.
--
-- The contradiction was already visible in the code: `list_coach_siblings()`
-- is SECURITY DEFINER precisely because clients cannot read sibling profiles,
-- and useSendFriendRequest's own docblock says so — while the policy it writes
-- through depended on exactly that read.
--
-- Fix the predicate, not the profiles policies: widening `profiles` SELECT to
-- siblings would expose whole rows to satisfy one boolean. `shares_my_coach`
-- answers just that boolean, the same way `my_coach_id()` already does.
--
-- The same-coach rule is unchanged and still double-covered: this policy, plus
-- `friendships_before_insert`, which raises friends_must_share_coach and
-- computes coach_id/pair_id/member_names server-side regardless of payload.
-- ---------------------------------------------------------------------------

create function public.shares_my_coach(p_other_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me, public.profiles other
    where me.id = (select auth.uid())
      and other.id = p_other_id
      and me.invited_by is not null
      and me.invited_by = other.invited_by
  );
$$;

comment on function public.shares_my_coach(uuid) is
  'True when the calling user and p_other_id are both clients of the same coach. SECURITY DEFINER because profiles RLS deliberately hides sibling rows from clients (see list_coach_siblings) — this returns only the boolean, never the row, so it is usable inside a policy without widening any SELECT.';

revoke execute on function public.shares_my_coach(uuid) from public, anon;
grant execute on function public.shares_my_coach(uuid) to authenticated;

drop policy if exists friendships_client_insert on public.friendships;

create policy friendships_client_insert on public.friendships
for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and ((select auth.uid()) = client_id or (select auth.uid()) = friend_id)
  and status = 'pending'
  -- coach_id is trigger-computed, but pin it anyway: BEFORE triggers run
  -- before WITH CHECK, so this asserts what the trigger produced rather than
  -- trusting the payload.
  and coach_id = public.my_coach_id()
  and public.shares_my_coach(
    case when (select auth.uid()) = client_id then friend_id else client_id end
  )
);

comment on policy friendships_client_insert on public.friendships is
  'A client may open a PENDING request to another client of the same coach, as themselves. Same-coach is checked through shares_my_coach() rather than a direct profiles read, because profiles RLS hides sibling rows from clients — reading them inline made this policy unsatisfiable (0029).';
