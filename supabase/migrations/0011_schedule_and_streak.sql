-- Wave 3.2: schedule resolution + streak computation.
--
-- Ports (exactly) old-app logic from:
--   src/lib/assignments/schedule.ts (resolveWeekSchedule / phase flattening)
--   src/lib/server/changeRequests.ts (resolveScheduledWorkoutId)
--   src/lib/services/streak.ts (computeScheduleAwareStreak, finding #1)
-- "Today" = device-synced profiles.timezone (falls back to America/New_York).

-- ---------------------------------------------------------------------------
-- client_today: profile-timezone "today" helper
-- ---------------------------------------------------------------------------

create function public.client_today(p_client_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select timezone from public.profiles where id = p_client_id),
    'America/New_York'
  ))::date;
$$;

comment on function public.client_today(uuid) is
  'Client''s current local calendar date, per profiles.timezone (device-synced), defaulting to America/New_York when unset.';

revoke execute on function public.client_today(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_scheduled_workout: schedule resolution (override wins, else
-- computed program/phase schedule)
-- ---------------------------------------------------------------------------

create function public.resolve_scheduled_workout(p_client_id uuid, p_date date)
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
  select a.* into v_assignment
  from public.assignments a
  where a.client_id = p_client_id and a.active
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

  -- A program has EITHER program-level week_schedules rows OR phase-level
  -- (never both — enforced by week_schedules' check constraint). Phase weeks
  -- flatten to global week numbers in phase sort_order: phase 1 weeks 1..N
  -- become global weeks 1..N, phase 2 continues from there, etc.
  select ws.workout_id into v_workout_id
  from public.week_schedules ws
  where ws.program_id = v_program.id
    and ws.week_number = v_week_number
    and ws.day_of_week = v_day_of_week;

  if found then
    return v_workout_id;
  end if;

  -- Phase-scoped schedule: flatten phases (in sort_order) to global week
  -- numbers — phase 1 weeks 1..N become global weeks 1..N, phase 2
  -- continues from N+1, etc. — then find which phase owns v_week_number and
  -- resolve its local week number within that phase.
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
  'Resolves the workout scheduled for a client on a date: assignment_date_overrides wins outright (NULL workout_id = explicit rest); otherwise computed from the active assignment''s program (or its phases, flattened to global week numbers in phase sort_order). Returns NULL for no active assignment, before start_date, past program length, or an unscheduled (rest) day.';

revoke execute on function public.resolve_scheduled_workout(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- compute_streak: schedule-aware streak, ported EXACTLY from
-- computeScheduleAwareStreak (old-app finding #1), with plain-consecutive
-- fallback when the client has no active assignment/program.
-- ---------------------------------------------------------------------------

create function public.compute_streak(p_client_id uuid, p_as_of date default null)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_as_of date := coalesce(p_as_of, public.client_today(p_client_id));
  v_cursor date;
  v_streak int := 0;
  v_start_date date;
  v_has_assignment boolean;
  v_scheduled_today uuid;
  v_completed boolean;
  v_i int;
begin
  select true, a.start_date into v_has_assignment, v_start_date
  from public.assignments a
  where a.client_id = p_client_id and a.active
  limit 1;

  if v_has_assignment then
    -- Grace: if today is a scheduled workout day and it isn't logged
    -- complete yet, start the walk from yesterday instead of penalizing the
    -- still-pending day.
    v_scheduled_today := public.resolve_scheduled_workout(p_client_id, v_as_of);
    v_completed := exists (
      select 1 from public.workout_logs wl
      where wl.client_id = p_client_id and wl.date = v_as_of and wl.completed
    );

    if v_scheduled_today is not null and not v_completed then
      v_cursor := v_as_of - 1;
    else
      v_cursor := v_as_of;
    end if;

    for v_i in 0..89 loop
      if v_cursor < v_start_date then
        exit;
      end if;

      v_scheduled_today := public.resolve_scheduled_workout(p_client_id, v_cursor);
      v_completed := exists (
        select 1 from public.workout_logs wl
        where wl.client_id = p_client_id and wl.date = v_cursor and wl.completed
      );

      if v_scheduled_today is not null and not v_completed then
        exit;
      end if;

      v_streak := v_streak + 1;
      v_cursor := v_cursor - 1;
    end loop;

    return v_streak;
  end if;

  -- Fallback: no active assignment/program — plain consecutive-completed-
  -- dates walk. Same grace: if today has no completed log, start from
  -- yesterday so the streak isn't shown as 0 before today's log lands.
  v_completed := exists (
    select 1 from public.workout_logs wl
    where wl.client_id = p_client_id and wl.date = v_as_of and wl.completed
  );
  v_cursor := case when v_completed then v_as_of else v_as_of - 1 end;

  for v_i in 0..89 loop
    if not exists (
      select 1 from public.workout_logs wl
      where wl.client_id = p_client_id and wl.date = v_cursor and wl.completed
    ) then
      exit;
    end if;
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  end loop;

  return v_streak;
end;
$$;

comment on function public.compute_streak(uuid, date) is
  'Schedule-aware streak, ported exactly from old-app computeScheduleAwareStreak (finding #1): walks back from as_of (default client_today()), granting a grace day when as_of is scheduled-but-not-yet-completed, stopping (uncounted) before assignment start_date, breaking on a missed scheduled day, 90-day cap. Falls back to a plain consecutive-completed-dates walk (same grace) when the client has no active assignment.';

revoke execute on function public.compute_streak(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_my_streak: RPC wrapper for the calling client
-- ---------------------------------------------------------------------------

create function public.get_my_streak()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select public.compute_streak(auth.uid());
$$;

comment on function public.get_my_streak() is
  'RPC: compute_streak() for the calling user. Callable by any authenticated client to read their own streak.';

revoke execute on function public.get_my_streak() from public, anon;
grant execute on function public.get_my_streak() to authenticated;
