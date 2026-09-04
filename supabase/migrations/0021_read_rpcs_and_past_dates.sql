-- Phase 4 of the ruleset remediation (docs/rules/violations.md B6, B9, S-4).
--
-- Schedule resolution existed in THREE places: the authoritative SQL
-- (resolve_scheduled_workout), a mirror in packages/shared/src/schedule.ts,
-- and a third inline copy in useTodayWorkout. Two of them had already drifted
-- (B9). The mirrors existed because resolve_scheduled_workout is revoked from
-- `authenticated` and there was no RPC exposing it, so the client had no way
-- to ask.
--
-- get_workout_day / get_workout_week expose it, so the mirrors can be deleted
-- outright. They also collapse the day screen's four-level fetch waterfall
-- (assignment context -> log -> workout/exercises/previous -> warmup) into one
-- round trip (S-4).
--
-- B6: resolve_scheduled_workout only ever looked at the ACTIVE assignment, so
-- reassigning a client silently re-resolved their PAST dates against the new
-- program — history showing workouts they were never given. It now resolves a
-- date against whichever assignment was in force on that date.

-- ---------------------------------------------------------------------------
-- resolve_scheduled_workout: resolve against the assignment in force (B6)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_scheduled_workout(p_client_id uuid, p_date date)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments%rowtype;
  v_program public.programs%rowtype;
  v_override_exists boolean;
  v_override_workout_id uuid;
  v_days_diff int;
  v_week_number int;
  v_day_of_week public.day_of_week;
  v_workout_id uuid;
begin
  -- The assignment in force ON p_date: the most recent one that had started
  -- by then. Falls back to the earliest assignment for dates before any
  -- start_date so "before the program began" still resolves to null below
  -- rather than to whatever is active today.
  select a.* into v_assignment
  from public.assignments a
  where a.client_id = p_client_id
    and a.start_date <= p_date
  order by a.start_date desc, a.created_at desc
  limit 1;

  if v_assignment.id is null then
    return null;
  end if;

  -- Override wins outright, including an explicit-rest NULL workout_id.
  select true, ado.workout_id
  into v_override_exists, v_override_workout_id
  from public.assignment_date_overrides ado
  where ado.assignment_id = v_assignment.id and ado.date = p_date;

  if v_override_exists then
    return v_override_workout_id;
  end if;

  if p_date < v_assignment.start_date then
    return null;
  end if;

  select p.* into v_program
  from public.programs p
  where p.id = v_assignment.program_id;

  if v_program.id is null then
    return null;
  end if;

  v_days_diff := p_date - v_assignment.start_date;
  v_week_number := (v_days_diff / 7) + 1;

  if v_program.weeks is not null and v_week_number > v_program.weeks then
    return null;
  end if;

  -- ISO day-of-week: 1=Monday..7=Sunday, matching public.day_of_week's
  -- declaration order (monday, tuesday, ..., sunday).
  v_day_of_week := (enum_range(null::public.day_of_week))[extract(isodow from p_date)::int];

  select ws.workout_id into v_workout_id
  from public.week_schedules ws
  where ws.program_id = v_program.id
    and ws.week_number = v_week_number
    and ws.day_of_week = v_day_of_week;

  if found then
    return v_workout_id;
  end if;

  -- Phase-scoped schedule: flatten phases (in sort_order) to global week
  -- numbers, find which phase owns v_week_number, resolve its local week.
  with phase_offsets as (
    select
      ph.id,
      ph.weeks,
      coalesce(sum(ph.weeks) over (
        order by ph.sort_order
        rows between unbounded preceding and 1 preceding
      ), 0) as prior_weeks
    from public.program_phases ph
    where ph.program_id = v_program.id
  )
  select ws.workout_id into v_workout_id
  from phase_offsets po
  join public.week_schedules ws
    on ws.phase_id = po.id
    and ws.week_number = v_week_number - po.prior_weeks
  where ws.day_of_week = v_day_of_week
    and v_week_number > po.prior_weeks
    and v_week_number <= po.prior_weeks + coalesce(po.weeks, 0);

  return v_workout_id;
end;
$$;

comment on function public.resolve_scheduled_workout(uuid, date) is
  'Resolves the workout scheduled for a client on a date, against the assignment that was IN FORCE on that date (not merely the active one) so reassigning never rewrites what a past date resolves to. assignment_date_overrides wins outright (NULL workout_id = explicit rest); otherwise computed from that assignment''s program, or its phases flattened to global week numbers in phase sort_order. Returns NULL before start_date, past program length, or on an unscheduled day.';

-- ---------------------------------------------------------------------------
-- get_workout_day: everything the day screen needs, in one call (S-4, B9)
-- ---------------------------------------------------------------------------

create function public.get_workout_day(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
  v_workout_id uuid;
  v_assignment public.assignments%rowtype;
  v_program public.programs%rowtype;
  v_end_date date;
  v_warmup_id uuid;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  v_workout_id := public.resolve_scheduled_workout(v_client_id, p_date);

  select a.* into v_assignment
  from public.assignments a
  where a.client_id = v_client_id and a.active
  limit 1;

  if v_assignment.id is not null then
    select p.* into v_program from public.programs p where p.id = v_assignment.program_id;
    v_end_date := v_assignment.start_date
      + (coalesce(nullif(v_program.weeks, 0), 1) * 7 - 1);
  end if;

  select warmup_id into v_warmup_id from public.workouts where id = v_workout_id;

  return jsonb_build_object(
    'workout', (select to_jsonb(w) from public.workouts w where w.id = v_workout_id),
    'exercises', coalesce((
      select jsonb_agg(to_jsonb(we) || jsonb_build_object(
               'exercises', (select to_jsonb(e) from public.exercises e where e.id = we.exercise_id))
             order by we.sort_order)
      from public.workout_exercises we
      where we.workout_id = v_workout_id
    ), '[]'::jsonb),
    'warmup', (select to_jsonb(w) from public.workouts w where w.id = v_warmup_id),
    'warmup_exercises', coalesce((
      select jsonb_agg(to_jsonb(we) || jsonb_build_object(
               'exercises', (select to_jsonb(e) from public.exercises e where e.id = we.exercise_id))
             order by we.sort_order)
      from public.workout_exercises we
      where we.workout_id = v_warmup_id
    ), '[]'::jsonb),
    'log', (
      select to_jsonb(wl) || jsonb_build_object('exercise_logs', coalesce((
        select jsonb_agg(to_jsonb(el) || jsonb_build_object('set_logs', coalesce((
          select jsonb_agg(to_jsonb(sl) order by sl.set_number)
          from public.set_logs sl where sl.exercise_log_id = el.id
        ), '[]'::jsonb)) order by el.sort_order)
        from public.exercise_logs el where el.workout_log_id = wl.id
      ), '[]'::jsonb))
      from public.workout_logs wl
      where wl.client_id = v_client_id and wl.date = p_date
    ),
    -- "Last time" = the client's most recent completed log before this date,
    -- in ANY workout. The logger pairs prior sets by exercise, so scoping to
    -- the same workout row only blanked the column after a reassign (P-4).
    'previous_log', (
      select to_jsonb(wl) || jsonb_build_object('exercise_logs', coalesce((
        select jsonb_agg(to_jsonb(el) || jsonb_build_object('set_logs', coalesce((
          select jsonb_agg(to_jsonb(sl) order by sl.set_number)
          from public.set_logs sl where sl.exercise_log_id = el.id
        ), '[]'::jsonb)) order by el.sort_order)
        from public.exercise_logs el where el.workout_log_id = wl.id
      ), '[]'::jsonb))
      from public.workout_logs wl
      where wl.client_id = v_client_id and wl.completed and wl.date < p_date
      order by wl.date desc
      limit 1
    ),
    'in_range', v_assignment.id is not null
      and p_date >= v_assignment.start_date
      and p_date <= v_end_date,
    'program_start_date', v_assignment.start_date,
    'program_end_date', v_end_date
  );
end;
$$;

comment on function public.get_workout_day(date) is
  'RPC: everything the day screen renders for the calling client on a date — resolved workout, its exercises, warmup and warmup exercises, that date''s log with children, the previous completed log, and the program window. One round trip in place of a four-level client-side waterfall, and the only place schedule resolution happens. Raises: forbidden.';

revoke execute on function public.get_workout_day(date) from public, anon;
grant execute on function public.get_workout_day(date) to authenticated;

-- ---------------------------------------------------------------------------
-- get_workout_week: the 7-day grid (the other reason the mirror survived)
-- ---------------------------------------------------------------------------

create function public.get_workout_week(p_start_date date, p_days int default 7)
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
        'workout_id', public.resolve_scheduled_workout(v_client_id, d::date),
        'completed', exists (
          select 1 from public.workout_logs wl
          where wl.client_id = v_client_id and wl.date = d::date and wl.completed
        )
      )
      order by d
    )
    from generate_series(p_start_date, p_start_date + (p_days - 1), interval '1 day') d
  ), '[]'::jsonb);
end;
$$;

comment on function public.get_workout_week(date, int) is
  'RPC: resolves a run of consecutive days for the calling client — the scheduled workout id and whether it is logged complete — through the same resolve_scheduled_workout the day view uses. Exists so the week grid does not need a client-side copy of the resolution rules. Raises: forbidden.';

revoke execute on function public.get_workout_week(date, int) from public, anon;
grant execute on function public.get_workout_week(date, int) to authenticated;
