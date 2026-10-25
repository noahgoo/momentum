-- ---------------------------------------------------------------------------
-- 0033: the read RPCs resolve to sessions.
--
-- The MIGRATE step of expand/migrate/contract. 0032 made both writers populate
-- sessions alongside week_schedules, so the two are in sync and reads can move
-- across safely. 0035 stops the week_schedules writes and drops the table.
--
-- resolve_scheduled_workout now returns a SESSIONS id. The name is kept for
-- this release so every caller's signature is unchanged, and so is every JSON
-- key these RPCs return — apps/mobile passes these ids back opaquely
-- (useSaveWorkoutLog sends whatever get_workout_day gave it), so a build that
-- predates this migration keeps working.
--
-- Verified before writing this: apps/mobile dereferences only name, id,
-- estimated_duration_minutes and equipment off the `workout` and `warmup`
-- payload keys, all of which sessions carries. Nothing reads type, warmup_id,
-- created_by, created_at or client_id off them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The three pointers that hold what resolve_scheduled_workout returned
--
-- workout_logs.workout_id, change_requests.workout_id and
-- assignment_date_overrides.workout_id are all written from
-- resolve_scheduled_workout, so the moment it returns a session id they point
-- at the wrong table. This cannot wait for the drop of week_schedules — the
-- seed fails on workout_logs_workout_id_fkey without it.
--
-- Two of the three were bare `references` with no on-delete clause (0003:159,
-- 0002:164), which fails a delete late and opaquely; R4's taxonomy is applied
-- to both here. workout_logs was already `set null` (0019:46).
--
-- Existing values point at workouts rows and have no session equivalent, so
-- they are nulled rather than translated. Provenance, not dependency: no
-- history is lost, and there is no production data.
--
-- Runs BEFORE the function redefinitions below, not after: nulling
-- workout_logs.workout_id fires refresh_client_summary_on_workout_logs
-- synchronously, and on a database with real rows that trigger actually
-- executes mid-migration. If refresh_client_summary had already been
-- replaced to read assignment_date_overrides.session_id at that point, it
-- would fail with "column ado.session_id does not exist" — that column does
-- not exist until the rename a few statements down. Doing the null-and-rename
-- first means the trigger still runs against the OLD (0012) function body,
-- which reads columns that already exist.
-- ---------------------------------------------------------------------------

update public.workout_logs set workout_id = null;
update public.change_requests set workout_id = null;
update public.assignment_date_overrides set workout_id = null;

alter table public.workout_logs drop constraint workout_logs_workout_id_fkey;
alter table public.workout_logs rename column workout_id to session_id;
alter table public.workout_logs
  add constraint workout_logs_session_id_fkey
    foreign key (session_id) references public.sessions (id) on delete set null;
alter index public.workout_logs_workout_id_idx rename to workout_logs_session_id_idx;

alter table public.workout_logs add column session_name text;

comment on column public.workout_logs.session_id is
  'Provenance: the session this log was recorded against. `on delete set null` — history survives the session being rescheduled away or its program rebuilt (R4). Never joined for display; session_name is the snapshot.';

comment on column public.workout_logs.session_name is
  'Snapshot of sessions.name at log time. History renders the name the client was actually given rather than whatever the session is called now, and still renders it once the session is gone (R8) — the same reason exercise_logs.exercise_name exists.';

alter table public.change_requests drop constraint change_requests_workout_id_fkey;
alter table public.change_requests rename column workout_id to session_id;
alter table public.change_requests
  add constraint change_requests_session_id_fkey
    foreign key (session_id) references public.sessions (id) on delete set null;
alter index public.change_requests_workout_id_idx rename to change_requests_session_id_idx;

comment on column public.change_requests.session_id is
  'What was scheduled when the request was FILED, for display only. accept_change_request re-resolves live and never trusts it (C5). `on delete set null`; was a bare reference (NO ACTION) before, which raised a raw 23503 that nothing counted.';

alter table public.assignment_date_overrides drop constraint assignment_date_overrides_workout_id_fkey;
alter table public.assignment_date_overrides rename column workout_id to session_id;
alter table public.assignment_date_overrides
  add constraint assignment_date_overrides_session_id_fkey
    foreign key (session_id) references public.sessions (id) on delete cascade;
alter index public.assignment_date_overrides_workout_id_idx rename to assignment_date_overrides_session_id_idx;

comment on column public.assignment_date_overrides.session_id is
  'The session moved onto this date; NULL means an explicit rest day. `on delete cascade`, not `set null`: an override pointing at a deleted session is meaningless, and silently turning it into a rest day would hide the deletion from the client — cascading restores the computed schedule for that date instead. Note the asymmetry — accept_change_request writes a PAIR of overrides, so deleting one session leaves the other half standing as a rest day on the source date.';

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
  v_override_session_id uuid;
  v_days_diff int;
  v_week_number int;
  v_day_of_week public.day_of_week;
  v_session_id uuid;
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

  -- Override wins outright, including an explicit-rest NULL session_id.
  -- That column is repointed at sessions further down this migration: it
  -- holds whatever this function returned, so it could not stay pointed at
  -- workouts once this function started returning session ids.
  select true, ado.session_id
  into v_override_exists, v_override_session_id
  from public.assignment_date_overrides ado
  where ado.assignment_id = v_assignment.id and ado.date = p_date;

  if v_override_exists then
    return v_override_session_id;
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

  select s.id into v_session_id
  from public.sessions s
  where s.program_id = v_program.id
    and s.week_number = v_week_number
    and s.day_of_week = v_day_of_week;

  if found then
    return v_session_id;
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
  select s.id into v_session_id
  from phase_offsets po
  join public.sessions s
    on s.phase_id = po.id
    and s.week_number = v_week_number - po.prior_weeks
  where s.day_of_week = v_day_of_week
    and v_week_number > po.prior_weeks
    and v_week_number <= po.prior_weeks + coalesce(po.weeks, 0);

  return v_session_id;
end;
$$;

comment on function public.resolve_scheduled_workout(uuid, date) is
  'Resolves the SESSION scheduled for a client on a date, against the assignment that was IN FORCE on that date (not merely the active one) so reassigning never rewrites what a past date resolves to. assignment_date_overrides wins outright (NULL = explicit rest); otherwise computed from that assignment''s program, or its phases flattened to global week numbers in phase sort_order. Returns NULL before start_date, past program length, or on an unscheduled day. Named for what it resolved before the sessions split; the id it returns is public.sessions.id. Its inverse — session to date — must share this week arithmetic and phase flattening (R5).';

-- ---------------------------------------------------------------------------
-- get_workout_day: same payload keys, sourced from the session
-- ---------------------------------------------------------------------------

create or replace function public.get_workout_day(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
  v_session_id uuid;
  v_assignment record;
  v_program record;
  v_end_date date;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  v_session_id := public.resolve_scheduled_workout(v_client_id, p_date);

  select a.* into v_assignment
  from public.assignments a
  where a.client_id = v_client_id and a.start_date <= p_date
  order by a.start_date desc, a.created_at desc
  limit 1;

  if v_assignment.id is not null then
    select p.* into v_program from public.programs p where p.id = v_assignment.program_id;
    v_end_date := v_assignment.start_date
      + (coalesce(nullif(v_program.weeks, 0), 1) * 7 - 1);
  end if;

  return jsonb_build_object(
    -- Key names unchanged so an older mobile build keeps working; the shape
    -- behind `workout` is now a session. The warm-up is no longer a second
    -- workouts row reached through warmup_id — it is this session's
    -- section='warmup' rows, so `warmup` is synthesized from the two warmup
    -- columns and is null exactly when there are none.
    'workout', (select to_jsonb(s) from public.sessions s where s.id = v_session_id),
    'exercises', coalesce((
      select jsonb_agg(to_jsonb(se) || jsonb_build_object(
               'exercises', (select to_jsonb(e) from public.exercises e where e.id = se.exercise_id))
             order by se.sort_order)
      from public.session_exercises se
      where se.session_id = v_session_id and se.section = 'main'
    ), '[]'::jsonb),
    'warmup', (
      select jsonb_build_object(
        'id', s.warmup_source_workout_id,
        'name', s.warmup_name,
        'estimated_duration_minutes', null::int,
        'equipment', null::text[]
      )
      from public.sessions s
      where s.id = v_session_id
        and exists (
          select 1 from public.session_exercises se
          where se.session_id = s.id and se.section = 'warmup'
        )
    ),
    'warmup_exercises', coalesce((
      select jsonb_agg(to_jsonb(se) || jsonb_build_object(
               'exercises', (select to_jsonb(e) from public.exercises e where e.id = se.exercise_id))
             order by se.sort_order)
      from public.session_exercises se
      where se.session_id = v_session_id and se.section = 'warmup'
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
    -- Per-exercise last weights, for resolving weight_delta targets. Keyed
    -- {exercise_id: {set_number: {weight, weight_unit}}} so the logger looks
    -- up by identity rather than array position (P3).
    --
    -- weight_entered is the filter that matters: per P2 a bare check-off
    -- records no real lift, and progressing a client off a number they never
    -- typed is the exact failure P2 exists to prevent.
    'last_set_weights', coalesce((
      with scheduled as (
        select distinct se.exercise_id
        from public.session_exercises se
        where se.session_id = v_session_id
          and se.section = 'main'
          and se.exercise_id is not null
      ),
      latest as (
        select distinct on (el.exercise_id)
               el.exercise_id,
               el.id as exercise_log_id
        from public.exercise_logs el
        join public.workout_logs wl on wl.id = el.workout_log_id
        join scheduled s on s.exercise_id = el.exercise_id
        where wl.client_id = v_client_id
          and wl.completed
          and wl.date < p_date
          and exists (
            select 1 from public.set_logs sl
            where sl.exercise_log_id = el.id
              and sl.weight_entered
              and sl.weight is not null
          )
        order by el.exercise_id, wl.date desc
      )
      select jsonb_object_agg(l.exercise_id::text, l.sets)
      from (
        select latest.exercise_id,
               jsonb_object_agg(
                 sl.set_number::text,
                 jsonb_build_object('weight', sl.weight, 'weight_unit', sl.weight_unit)
               ) as sets
        from latest
        join public.set_logs sl on sl.exercise_log_id = latest.exercise_log_id
        where sl.weight_entered and sl.weight is not null
        group by latest.exercise_id
      ) l
    ), '{}'::jsonb),
    'in_range', v_assignment.id is not null
      and p_date >= v_assignment.start_date
      and p_date <= v_end_date,
    'program_start_date', v_assignment.start_date,
    'program_end_date', v_end_date
  );
end;
$$;

comment on function public.get_workout_day(date) is
  'RPC: everything the client day screen needs in one call — the scheduled session and its main exercises, the warm-up half, today''s log, the previous completed log, and per-exercise last weights for resolving weight_delta targets. The `workout` key now carries a public.sessions row and `warmup` is synthesized from the session''s warmup columns rather than a second workouts row; the key names are unchanged so an older client build keeps working. Key set is pinned by supabase/tests/0021_read_rpc_assertions.sql — update it in the same commit that changes this payload. Raises: forbidden.';

-- ---------------------------------------------------------------------------
-- get_workout_week: adds `name` so the week grid stops reading workouts
-- ---------------------------------------------------------------------------

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
        'workout_id', public.resolve_scheduled_workout(v_client_id, d::date),
        -- New. The week grid used to take the ids from here and then select
        -- from `workouts` itself just to get names; a client has no reason to
        -- read the coach's library, and after the split will have no policy
        -- letting them. Returning the name closes that read.
        'name', (
          select s.name from public.sessions s
          where s.id = public.resolve_scheduled_workout(v_client_id, d::date)
        ),
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
  'RPC: resolves a run of consecutive days for the calling client — the scheduled session id, its name, and whether it is logged complete — through the same resolve_scheduled_workout the day view uses. Exists so the week grid does not need a client-side copy of the resolution rules, and now so it does not need to read the coach''s library for display names either. Raises: forbidden.';

-- ---------------------------------------------------------------------------
-- refresh_client_summary: today's name comes off the session
--
-- Body is 0012's verbatim apart from the two lines that read `workouts`.
-- ---------------------------------------------------------------------------

create or replace function public.refresh_client_summary(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_today date;
  v_today_session_id uuid;
  v_today_workout_name text;
  v_workout_done boolean;
  v_has_program boolean;
  v_active_goal_count int;
  v_goals_completed_today int;
  v_streak int;
  v_unread_for_coach boolean;
  v_last_message_at timestamptz;
begin
  select * into v_profile from public.profiles where id = p_client_id;

  -- Client deleted, or no longer a client (e.g. role changed) — the summary
  -- row no longer applies.
  if v_profile.id is null or v_profile.role <> 'client' then
    delete from public.client_summaries where client_id = p_client_id;
    return;
  end if;

  v_today := public.client_today(p_client_id);

  select exists (
    select 1 from public.assignments a where a.client_id = p_client_id and a.active
  ) into v_has_program;

  -- Now a session id, and the name comes off the session: a client's
  -- scheduled day carries its own snapshotted name (R8), and a client has
  -- no reason to reach into the coach's library for it.
  v_today_session_id := public.resolve_scheduled_workout(p_client_id, v_today);

  select s.name into v_today_workout_name
  from public.sessions s
  where s.id = v_today_session_id;

  select exists (
    select 1 from public.workout_logs wl
    where wl.client_id = p_client_id and wl.date = v_today and wl.completed
  ) into v_workout_done;

  select count(*) into v_active_goal_count
  from public.goals g
  where g.client_id = p_client_id and g.active;

  select count(*) into v_goals_completed_today
  from public.goal_logs gl
  where gl.client_id = p_client_id and gl.date = v_today;

  v_streak := public.compute_streak(p_client_id, v_today);

  select t.unread_for_coach, t.last_message_at
  into v_unread_for_coach, v_last_message_at
  from public.threads t
  where t.client_id = p_client_id;

  insert into public.client_summaries (
    client_id, coach_id, display_name, email, disabled,
    has_program, today_workout_name, workout_done,
    active_goal_count, goals_completed_today, streak,
    unread_for_coach, last_message_at, updated_at
  ) values (
    p_client_id, v_profile.invited_by, v_profile.display_name, v_profile.email, v_profile.disabled,
    v_has_program, v_today_workout_name, coalesce(v_workout_done, false),
    coalesce(v_active_goal_count, 0), coalesce(v_goals_completed_today, 0), coalesce(v_streak, 0),
    coalesce(v_unread_for_coach, false), v_last_message_at, now()
  )
  on conflict (client_id) do update set
    coach_id = excluded.coach_id,
    display_name = excluded.display_name,
    email = excluded.email,
    disabled = excluded.disabled,
    has_program = excluded.has_program,
    today_workout_name = excluded.today_workout_name,
    workout_done = excluded.workout_done,
    active_goal_count = excluded.active_goal_count,
    goals_completed_today = excluded.goals_completed_today,
    streak = excluded.streak,
    unread_for_coach = excluded.unread_for_coach,
    last_message_at = excluded.last_message_at,
    updated_at = now();
end;
$$;

comment on function public.refresh_client_summary(uuid) is
  'Recomputes and upserts one client''s client_summaries row from current data; deletes the row if the profile is gone or is no longer a client. today_workout_name comes off the scheduled session, which snapshots its own name. Trigger- and cron-driven only — never called by application code directly.';

revoke execute on function public.refresh_client_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The writers that store what resolve returned. Bodies are verbatim apart
-- from the column they write.
-- ---------------------------------------------------------------------------

create or replace function public.set_warmup_completed(p_date date, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
  v_log_id uuid;
  v_session_id uuid;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  select id into v_log_id
  from public.workout_logs
  where client_id = v_client_id and date = p_date;

  if v_log_id is not null then
    -- Patch by id, touching only this writer's column.
    update public.workout_logs set warmup_completed = p_completed where id = v_log_id;
    return;
  end if;

  -- No log yet: create a stub, but only for a date that actually has a
  -- workout. Without this a rest day could get a workout_logs row.
  v_session_id := public.resolve_scheduled_workout(v_client_id, p_date);
  if v_session_id is null then
    raise exception 'not_scheduled';
  end if;

  insert into public.workout_logs (client_id, date, session_id, session_name, warmup_completed)
  values (
    v_client_id, p_date, v_session_id,
    (select s.name from public.sessions s where s.id = v_session_id),
    p_completed
  );
end;
$$;

create or replace function public.save_workout_log(
  p_date date,
  p_workout_id uuid,
  p_completed boolean,
  p_exercises jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
  v_log_id uuid;
  v_exercise jsonb;
  v_exercise_log_id uuid;
  v_set jsonb;
  v_prescribed jsonb;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  -- A log may only exist for a date the client actually has a workout on.
  -- Checked only when creating: an existing log stays editable even if the
  -- coach later reschedules that date out from under it (the client did the
  -- work; the record stays).
  if not exists (
    select 1 from public.workout_logs
    where client_id = v_client_id and date = p_date
  ) and public.resolve_scheduled_workout(v_client_id, p_date) is null then
    raise exception 'not_scheduled';
  end if;

  -- warmup_completed is deliberately absent: it belongs to
  -- set_warmup_completed. One writer per column (docs/rules/notifications.md W1).
  -- p_workout_id is a SESSION id now. The parameter name is unchanged so an
  -- older mobile build keeps working; it passes back whatever
  -- get_workout_day handed it. session_name is snapshotted so history
  -- renders the name the client was given, and still renders after the
  -- session is rescheduled away (R8).
  insert into public.workout_logs (client_id, date, session_id, session_name, completed, completed_at)
  values (
    v_client_id,
    p_date,
    p_workout_id,
    (select s.name from public.sessions s where s.id = p_workout_id),
    p_completed,
    case when p_completed then now() else null end
  )
  on conflict (client_id, date) do update set
    session_id = excluded.session_id,
    session_name = excluded.session_name,
    completed = excluded.completed,
    completed_at = excluded.completed_at
  returning id into v_log_id;

  -- Replace children wholesale. Safe here in a way the client-side version
  -- was not: this is one transaction, so a failure rolls the delete back
  -- rather than leaving the log stripped (R3 permits a full replace inside a
  -- SQL function).
  delete from public.exercise_logs where workout_log_id = v_log_id;

  for v_exercise in select * from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
  loop
    v_prescribed := v_exercise->'prescribed';
    if v_prescribed is not null and not public.is_valid_set_configs(v_prescribed) then
      v_prescribed := null;
    end if;

    insert into public.exercise_logs (
      workout_log_id, exercise_id, exercise_name, mode, sort_order, prescribed
    )
    values (
      v_log_id,
      nullif(v_exercise->>'exercise_id', '')::uuid,
      coalesce(v_exercise->>'exercise_name', 'Exercise'),
      coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
      (v_exercise->>'sort_order')::int,
      v_prescribed
    )
    returning id into v_exercise_log_id;

    for v_set in select * from jsonb_array_elements(coalesce(v_exercise->'sets', '[]'::jsonb))
    loop
      v_prescribed := v_set->'prescribed';
      if v_prescribed is not null and not public.is_valid_set_config(v_prescribed) then
        v_prescribed := null;
      end if;

      insert into public.set_logs (
        exercise_log_id, set_number, completed, reps, weight, weight_unit,
        target_seconds, actual_seconds, actual_miles, prescribed, weight_entered
      )
      values (
        v_exercise_log_id,
        (v_set->>'set_number')::int,
        coalesce((v_set->>'completed')::boolean, false),
        (v_set->>'reps')::int,
        (v_set->>'weight')::numeric,
        (v_set->>'weight_unit')::public.weight_unit,
        (v_set->>'target_seconds')::int,
        (v_set->>'actual_seconds')::int,
        (v_set->>'actual_miles')::numeric,
        v_prescribed,
        coalesce((v_set->>'weight_entered')::boolean, false)
      );
    end loop;
  end loop;

  return v_log_id;
end;
$$;

create or replace function public.apply_change_request_swap(p_request_id uuid)
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
  insert into public.assignment_date_overrides (assignment_id, date, session_id)
  values (v_assignment.id, v_request.to_date, v_from_workout)
  on conflict (assignment_id, date) do update set session_id = excluded.session_id;

  insert into public.assignment_date_overrides (assignment_id, date, session_id)
  values (v_assignment.id, v_request.from_date, v_to_workout)
  on conflict (assignment_id, date) do update set session_id = excluded.session_id;

  update public.change_requests
  set status = 'accepted', responded_at = now()
  where id = p_request_id;
end;
$$;

comment on function public.save_workout_log(date, uuid, boolean, jsonb) is
  'RPC: upserts a client''s log for one date and replaces its exercise/set children in one transaction, snapshotting each set''s prescription so history renders from the log alone (P1). p_workout_id is a SESSION id — the parameter name is unchanged so an older client build keeps working. Refuses to create a log for an unscheduled date. Raises: forbidden, not_scheduled, invalid_set_config.';
