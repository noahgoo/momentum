-- ---------------------------------------------------------------------------
-- 0035: drop week_schedules.
--
-- Nothing has read it since 0033 and nothing has written it since 0034. Both
-- apps read sessions, and the generated types no longer name it.
--
-- workout_delete_blockers goes with it: it counted the week_schedules rows
-- pointing at a workout, and nothing points at a library workout any more. A
-- session records where it was copied FROM (source_workout_id, on delete set
-- null), which is provenance, not a dependency — deleting a library entry
-- leaves every scheduled day standing. Counting that is still useful to show
-- a coach before they delete, so it becomes an informational count rather
-- than a blocker.
-- ---------------------------------------------------------------------------

-- The policy that made a client able to read the coach's library. Its
-- week_schedules join is the literal blocker on the drop below, and it is also
-- what caused the 42P17 infinite recursion 0024 had to patch around. Sessions
-- carry everything a client needs — name, duration, exercises, warm-up — so no
-- client role has any reason to read `workouts` at all. Dropping it removes
-- that whole bug class by construction.
drop policy workouts_client_select on public.workouts;

-- Existed only to break that recursion.
drop function public.my_client_warmup_ids();

drop table public.week_schedules;

-- get_workout_week gains the duration the week grid renders. Mobile used to
-- take the resolved ids from this RPC and then select from `workouts` itself
-- for name and duration — a read a client can no longer make, and one that
-- would have failed SILENTLY by returning an empty set rather than erroring.
create or replace function public.get_workout_week(p_start_date date, p_days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'date', d::date,
        'workout_id', s.id,
        'name', s.name,
        'estimated_duration_minutes', s.estimated_duration_minutes,
        'completed', exists (
          select 1 from public.workout_logs wl
          where wl.client_id = v_client_id and wl.date = d::date and wl.completed
        )
      )
      order by d
    )
    from generate_series(p_start_date, p_start_date + (p_days - 1), interval '1 day') d
    left join public.sessions s
      on s.id = public.resolve_scheduled_workout(v_client_id, d::date)
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_workout_week(date, int) is
  'RPC: resolves a run of consecutive days for the calling client — the scheduled session id, its name and duration, and whether it is logged complete — through the same resolve_scheduled_workout the day view uses. Carries the display fields so the week grid needs no second query, which matters now that a client cannot read `workouts` at all. Raises: forbidden.';

drop function public.workout_delete_blockers(uuid);

create function public.workout_usage_count(p_workout_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Scoped to the caller's own workouts: SECURITY DEFINER bypasses RLS, and
  -- an unscoped count would confirm the existence of another coach's workout
  -- by id (same reasoning as program_delete_blockers).
  select count(*)::int
  from public.sessions s
  join public.workouts w on w.id = s.source_workout_id
  where s.source_workout_id = p_workout_id
    and w.created_by = auth.uid();
$$;

comment on function public.workout_usage_count(uuid) is
  'RPC: how many scheduled sessions were built from this library workout. INFORMATIONAL, not a blocker — source_workout_id is `on delete set null`, so deleting a library entry never touches a scheduled day. Lets the UI say "used in 12 sessions" before a delete rather than implying the delete will fail, which is what workout_delete_blockers did when a schedule still pointed at workouts.';

revoke execute on function public.workout_usage_count(uuid) from public, anon;
grant execute on function public.workout_usage_count(uuid) to authenticated;
