-- Wave 3.4: change-request accept/reject RPCs + friendship pair_id trigger
-- and shared-streak recomputation.
--
-- accept_change_request splits into two functions per the acceptance
-- criteria: the outer RPC does auth/ownership/status checks (SECURITY
-- DEFINER, callable by `authenticated`), then delegates the actual swap math
-- to an internal function with EXECUTE revoked from every client role — so
-- the swap logic is directly testable (as postgres) without needing to fake
-- auth.uid(), while remaining unreachable from PostgREST/any client role.

-- ---------------------------------------------------------------------------
-- apply_change_request_swap: internal swap logic, no auth checks
-- ---------------------------------------------------------------------------

create function public.apply_change_request_swap(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.change_requests%rowtype;
  v_assignment public.assignments%rowtype;
  v_program public.programs%rowtype;
  v_from_workout uuid;
  v_to_workout uuid;
begin
  select * into v_request from public.change_requests where id = p_request_id;

  if v_request.id is null then
    raise exception 'not_found_or_forbidden';
  end if;

  select a.* into v_assignment
  from public.assignments a
  where a.client_id = v_request.client_id and a.active
  limit 1;

  if v_assignment.id is null then
    raise exception 'no_active_assignment';
  end if;

  select p.* into v_program from public.programs p where p.id = v_assignment.program_id;
  if v_program.id is null then
    raise exception 'no_active_assignment';
  end if;

  -- Always re-resolve live at accept time — never trust a denormalized
  -- workout_id stored on the request itself.
  v_from_workout := public.resolve_scheduled_workout(v_request.client_id, v_request.from_date);
  v_to_workout := public.resolve_scheduled_workout(v_request.client_id, v_request.to_date);

  if v_from_workout is null then
    raise exception 'nothing_to_move';
  end if;

  -- SWAP semantics (finding #3): to_date gets what was on from_date;
  -- from_date gets what was on to_date (possibly NULL = explicit rest).
  insert into public.assignment_date_overrides (assignment_id, date, workout_id)
  values (v_assignment.id, v_request.to_date, v_from_workout)
  on conflict (assignment_id, date) do update set workout_id = excluded.workout_id;

  insert into public.assignment_date_overrides (assignment_id, date, workout_id)
  values (v_assignment.id, v_request.from_date, v_to_workout)
  on conflict (assignment_id, date) do update set workout_id = excluded.workout_id;

  update public.change_requests
  set status = 'accepted', responded_at = now()
  where id = p_request_id;
end;
$$;

comment on function public.apply_change_request_swap(uuid) is
  'Internal: performs the accept swap (finding #3) with no auth checks — assumes the caller (accept_change_request) already verified ownership/status. Re-resolves both dates live via resolve_scheduled_workout rather than trusting any stored workout_id. Not reachable by any client role; call only from accept_change_request or as postgres in tests.';

revoke execute on function public.apply_change_request_swap(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- accept_change_request: RPC — auth/ownership/status checks, then delegate
-- ---------------------------------------------------------------------------

create function public.accept_change_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.change_requests%rowtype;
begin
  select * into v_request
  from public.change_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.status <> 'pending' or v_request.coach_id <> auth.uid() then
    raise exception 'not_found_or_forbidden';
  end if;

  perform public.apply_change_request_swap(p_request_id);
end;
$$;

comment on function public.accept_change_request(uuid) is
  'RPC: coach accepts a pending change request. Locks the row (FOR UPDATE), requires status=pending and coach_id=auth.uid() (raises not_found_or_forbidden otherwise), then delegates the swap to apply_change_request_swap.';

revoke execute on function public.accept_change_request(uuid) from public, anon;
grant execute on function public.accept_change_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_change_request: RPC
-- ---------------------------------------------------------------------------

create function public.reject_change_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.change_requests%rowtype;
begin
  select * into v_request
  from public.change_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.status <> 'pending' or v_request.coach_id <> auth.uid() then
    raise exception 'not_found_or_forbidden';
  end if;

  update public.change_requests
  set status = 'rejected', responded_at = now()
  where id = p_request_id;
end;
$$;

comment on function public.reject_change_request(uuid) is
  'RPC: coach rejects a pending change request. Same lock/ownership/pending checks as accept_change_request.';

revoke execute on function public.reject_change_request(uuid) from public, anon;
grant execute on function public.reject_change_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- friendships_before_insert: pair_id, same-coach enforcement, member_names
-- ---------------------------------------------------------------------------

create function public.friendships_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_coach uuid;
  v_friend_coach uuid;
  v_client_name text;
  v_friend_name text;
begin
  select invited_by, display_name into v_client_coach, v_client_name
  from public.profiles where id = new.client_id;

  select invited_by, display_name into v_friend_coach, v_friend_name
  from public.profiles where id = new.friend_id;

  if v_client_coach is null or v_friend_coach is null or v_client_coach <> v_friend_coach then
    raise exception 'friends_must_share_coach';
  end if;

  new.coach_id := v_client_coach;
  new.pair_id := least(new.client_id::text, new.friend_id::text) || '_' || greatest(new.client_id::text, new.friend_id::text);
  new.member_names := jsonb_build_object(
    new.client_id::text, coalesce(v_client_name, ''),
    new.friend_id::text, coalesce(v_friend_name, '')
  );

  return new;
end;
$$;

comment on function public.friendships_before_insert() is
  'BEFORE INSERT on friendships: derives pair_id (sorted member UUIDs joined with ''_''), enforces both members share a coach and sets coach_id to it, and snapshots member_names. Raises friends_must_share_coach when the constraint is violated.';

revoke execute on function public.friendships_before_insert() from public, anon, authenticated;

create trigger friendships_before_insert
  before insert on public.friendships
  for each row
  execute function public.friendships_before_insert();

-- ---------------------------------------------------------------------------
-- recompute_friendship_stats: per-member stats + shared streak (finding #4)
-- ---------------------------------------------------------------------------

create function public.recompute_friendship_stats(p_pair_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_friendship public.friendships%rowtype;
  v_client_coach uuid;
  v_friend_coach uuid;
  v_client_today date;
  v_friend_today date;
  v_client_streak int;
  v_friend_streak int;
  v_client_has_today boolean;
  v_friend_has_today boolean;
  v_client_done_today boolean;
  v_friend_done_today boolean;
  v_stats jsonb;
  v_cursor date;
  v_shared_streak int := 0;
  v_i int;
  v_client_scheduled uuid;
  v_friend_scheduled uuid;
  v_client_completed boolean;
  v_friend_completed boolean;
  v_client_missed boolean;
  v_friend_missed boolean;
begin
  select * into v_friendship from public.friendships where pair_id = p_pair_id;
  if v_friendship.pair_id is null then
    return;
  end if;

  select invited_by into v_client_coach from public.profiles where id = v_friendship.client_id;
  select invited_by into v_friend_coach from public.profiles where id = v_friendship.friend_id;

  if v_client_coach is null or v_friend_coach is null or v_client_coach <> v_friend_coach then
    delete from public.friendships where pair_id = p_pair_id;
    return;
  end if;

  v_client_today := public.client_today(v_friendship.client_id);
  v_friend_today := public.client_today(v_friendship.friend_id);

  v_client_streak := public.compute_streak(v_friendship.client_id, v_client_today);
  v_friend_streak := public.compute_streak(v_friendship.friend_id, v_friend_today);

  v_client_scheduled := public.resolve_scheduled_workout(v_friendship.client_id, v_client_today);
  v_friend_scheduled := public.resolve_scheduled_workout(v_friendship.friend_id, v_friend_today);

  v_client_has_today := v_client_scheduled is not null;
  v_friend_has_today := v_friend_scheduled is not null;

  v_client_done_today := exists (
    select 1 from public.workout_logs wl
    where wl.client_id = v_friendship.client_id and wl.date = v_client_today and wl.completed
  );
  v_friend_done_today := exists (
    select 1 from public.workout_logs wl
    where wl.client_id = v_friendship.friend_id and wl.date = v_friend_today and wl.completed
  );

  v_stats := jsonb_build_object(
    v_friendship.client_id::text, jsonb_build_object(
      'streak', v_client_streak,
      'hasWorkoutToday', v_client_has_today,
      'workoutDoneToday', v_client_done_today,
      'date', v_client_today
    ),
    v_friendship.friend_id::text, jsonb_build_object(
      'streak', v_friend_streak,
      'hasWorkoutToday', v_friend_has_today,
      'workoutDoneToday', v_friend_done_today,
      'date', v_friend_today
    )
  );

  -- Shared streak (finding #4): walk back from the later of the two
  -- members' "today", max 90 days.
  --   - A definite miss (scheduled + not completed, strictly in that
  --     member's past) ends the streak.
  --   - A pending day (scheduled + not completed, but still that member's
  --     "today") is skipped — grace, doesn't count, doesn't break.
  --   - Otherwise the day counts if >=1 member completed a workout that
  --     day; a day where nobody trained (both rest, or scheduled-pending)
  --     is skipped silently without breaking.
  v_cursor := greatest(v_client_today, v_friend_today);

  for v_i in 0..89 loop
    v_client_scheduled := public.resolve_scheduled_workout(v_friendship.client_id, v_cursor);
    v_friend_scheduled := public.resolve_scheduled_workout(v_friendship.friend_id, v_cursor);

    v_client_completed := exists (
      select 1 from public.workout_logs wl
      where wl.client_id = v_friendship.client_id and wl.date = v_cursor and wl.completed
    );
    v_friend_completed := exists (
      select 1 from public.workout_logs wl
      where wl.client_id = v_friendship.friend_id and wl.date = v_cursor and wl.completed
    );

    v_client_missed := v_client_scheduled is not null and not v_client_completed and v_cursor < v_client_today;
    v_friend_missed := v_friend_scheduled is not null and not v_friend_completed and v_cursor < v_friend_today;

    if v_client_missed or v_friend_missed then
      exit;
    end if;

    if v_client_completed or v_friend_completed then
      v_shared_streak := v_shared_streak + 1;
    end if;

    v_cursor := v_cursor - 1;
  end loop;

  update public.friendships
  set stats = v_stats, shared_streak = v_shared_streak, stats_updated_at = now()
  where pair_id = p_pair_id;
end;
$$;

comment on function public.recompute_friendship_stats(text) is
  'Recomputes per-member stats (streak/hasWorkoutToday/workoutDoneToday/date) and shared_streak (finding #4: one member completing suffices; per-member today grace; shared rest days skipped silently) for one friendship pair. Deletes the friendship if the members no longer share a coach.';

revoke execute on function public.recompute_friendship_stats(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: workout_logs completion -> recompute the client's accepted
-- friendships' stats.
-- ---------------------------------------------------------------------------

create function public.trg_recompute_friendship_stats_on_workout_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pair_id text;
begin
  if new.completed and (tg_op = 'INSERT' or old.completed is distinct from new.completed) then
    for v_pair_id in
      select f.pair_id from public.friendships f
      where f.status = 'accepted' and new.client_id in (f.client_id, f.friend_id)
    loop
      perform public.recompute_friendship_stats(v_pair_id);
    end loop;
  end if;
  return new;
end;
$$;

comment on function public.trg_recompute_friendship_stats_on_workout_log() is
  'AFTER INSERT OR UPDATE on workout_logs: when completed becomes true, recomputes stats for every accepted friendship this client belongs to.';

revoke execute on function public.trg_recompute_friendship_stats_on_workout_log() from public, anon, authenticated;

create trigger recompute_friendship_stats_on_workout_log
  after insert or update on public.workout_logs
  for each row
  execute function public.trg_recompute_friendship_stats_on_workout_log();

-- ---------------------------------------------------------------------------
-- Trigger: friendship status -> 'accepted' seeds stats immediately.
-- Guarded against recursion: skip when only stats/shared_streak/
-- stats_updated_at changed (i.e. this trigger's own UPDATE).
-- ---------------------------------------------------------------------------

create function public.trg_recompute_friendship_stats_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted'
    and new.stats is not distinct from old.stats
    and new.shared_streak is not distinct from old.shared_streak
    and new.stats_updated_at is not distinct from old.stats_updated_at
  then
    perform public.recompute_friendship_stats(new.pair_id);
  end if;
  return new;
end;
$$;

comment on function public.trg_recompute_friendship_stats_on_accept() is
  'AFTER UPDATE on friendships: when status transitions to accepted, seeds stats. Guarded by comparing OLD/NEW stats/shared_streak/stats_updated_at so recompute_friendship_stats''s own UPDATE (which does not touch status) never re-enters this trigger.';

revoke execute on function public.trg_recompute_friendship_stats_on_accept() from public, anon, authenticated;

create trigger recompute_friendship_stats_on_accept
  after update on public.friendships
  for each row
  execute function public.trg_recompute_friendship_stats_on_accept();
