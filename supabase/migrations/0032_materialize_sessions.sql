-- ---------------------------------------------------------------------------
-- 0032: populate sessions, and keep them populated.
--
-- 0031 created the tables; nothing writes them yet. This is the EXPAND half of
-- expand/migrate/contract:
--
--   0032 (here)  both writers populate sessions AND keep writing
--                week_schedules. Reads still come from week_schedules.
--   0033/0034    reads move to sessions.
--   0035         writes stop going to week_schedules, and it is dropped.
--
-- The dual write is what makes the middle step safe. If sessions were only
-- populated at the moment reads switched, every program edited between the
-- two migrations would silently fail to appear.
--
-- public.resync_program_sessions(program_id) is the one implementation of
-- "make this program's sessions match its week_schedules", called from
-- copy_program_tree and save_program so the two cannot drift apart.
--
-- IT REPLACES A PROGRAM'S SESSIONS WHOLESALE. That is safe only while nothing
-- edits a session directly, which is true until the session editor lands.
-- Delete this function in the same commit that ships that editor — by then
-- save_program reconciles sessions itself and a wholesale replace would throw
-- away a coach's per-day work.
-- ---------------------------------------------------------------------------

create function public.resync_program_sessions(p_program_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Wholesale replace: see the header for why this is safe today and when it
  -- stops being. Cascades to session_exercises.
  delete from public.sessions s
  where s.program_id = p_program_id
     or s.phase_id in (
       select ph.id from public.program_phases ph where ph.program_id = p_program_id
     );

  -- One session per week_schedules row — the whole point. Where
  -- week_schedules pointed many (week, day) slots at one shared workout, each
  -- now gets its own copy, so editing week 3 cannot reach week 5.
  --
  -- Display fields are snapshotted from the source workout rather than joined
  -- live (R8): renaming a library entry must not rename a client's already
  -- scheduled day. The warm-up is flattened in — the workout it links through
  -- warmup_id becomes this session's warmup_name plus its section='warmup'
  -- exercise rows, which is what retires the self-FK.
  insert into public.sessions (
    program_id, phase_id, week_number, day_of_week,
    source_workout_id, name, description, estimated_duration_minutes, equipment,
    warmup_name, warmup_source_workout_id
  )
  select
    ws.program_id,
    ws.phase_id,
    ws.week_number,
    ws.day_of_week,
    w.id,
    w.name,
    w.description,
    w.estimated_duration_minutes,
    w.equipment,
    warm.name,
    warm.id
  from public.week_schedules ws
  join public.workouts w on w.id = ws.workout_id
  left join public.workouts warm on warm.id = w.warmup_id
  left join public.program_phases ph on ph.id = ws.phase_id
  where (ws.program_id = p_program_id or ph.program_id = p_program_id)
    and ws.workout_id is not null;

  -- Exercises for both halves, keyed back through the scope the session
  -- carries. `exercises` stays shared reference data and is not copied —
  -- session_exercises keep FKing into it, exactly as workout_exercises do.
  insert into public.session_exercises (
    session_id, section, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select
    s.id,
    'main'::public.session_section,
    we.exercise_id, we.sort_order, we.mode, we.set_configs, we.rest_seconds, we.notes
  from public.sessions s
  join public.workout_exercises we on we.workout_id = s.source_workout_id
  left join public.program_phases ph on ph.id = s.phase_id
  where s.program_id = p_program_id or ph.program_id = p_program_id;

  insert into public.session_exercises (
    session_id, section, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select
    s.id,
    'warmup'::public.session_section,
    we.exercise_id, we.sort_order, we.mode, we.set_configs, we.rest_seconds, we.notes
  from public.sessions s
  join public.workout_exercises we on we.workout_id = s.warmup_source_workout_id
  left join public.program_phases ph on ph.id = s.phase_id
  where s.program_id = p_program_id or ph.program_id = p_program_id;
end;
$$;

comment on function public.resync_program_sessions(uuid) is
  'Rebuilds one program''s sessions from its week_schedules, giving every (week, day) slot its own copy of the workout it pointed at and flattening that workout''s warm-up into section=''warmup'' rows. TRANSITIONAL: it replaces the program''s sessions wholesale, which is safe only while nothing edits a session directly. Delete it with the commit that ships the session editor. Called from copy_program_tree and save_program so the two cannot drift.';

revoke execute on function public.resync_program_sessions(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- copy_program_tree: unchanged, plus a resync of the copy it just made
--
-- The full rewrite — dropping _workout_map, the per-row insert loop and the
-- warm-up re-link, so an assign writes no workouts rows at all — lands in
-- 0035, once nothing reads week_schedules. Doing it here would mean this
-- migration both changes the copy's shape and introduces sessions, and a
-- regression in either would be hard to attribute to one of them.
-- ---------------------------------------------------------------------------

create or replace function public.copy_program_tree(
  p_program_id uuid,
  p_client_id uuid,
  p_name_suffix text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.programs%rowtype;
  v_new_program_id uuid;
begin
  select * into v_source from public.programs where id = p_program_id;
  if v_source.id is null then
    raise exception 'program_not_found';
  end if;

  insert into public.programs (name, description, weeks, created_by, client_id)
  values (
    v_source.name || coalesce(p_name_suffix, ''),
    v_source.description,
    v_source.weeks,
    v_source.created_by,
    p_client_id
  )
  returning id into v_new_program_id;

  -- Phases, keeping a map from old id to new so week_schedules can be remapped.
  create temp table if not exists _phase_map (old_id uuid, new_id uuid) on commit drop;
  delete from _phase_map;

  with inserted as (
    insert into public.program_phases (program_id, name, sort_order, weeks, active_days)
    select v_new_program_id, ph.name, ph.sort_order, ph.weeks, ph.active_days
    from public.program_phases ph
    where ph.program_id = p_program_id
    returning id, sort_order
  )
  insert into _phase_map (old_id, new_id)
  select ph.id, i.id
  from public.program_phases ph
  join inserted i on i.sort_order = ph.sort_order
  where ph.program_id = p_program_id;

  -- Workouts referenced by this program's schedule, plus any warmups they
  -- link to. Copied per client so editing one client's workout touches only
  -- them. `exercises` is reference data (name, video, defaults) and is NOT
  -- copied — instance workout_exercises keep FKing into the shared library.
  create temp table if not exists _workout_map (old_id uuid, new_id uuid) on commit drop;
  delete from _workout_map;

  -- INSERT ... RETURNING cannot return the source row's id alongside the new
  -- one, and matching them back up by name would collide whenever a coach has
  -- two workouts with the same name. Insert one at a time instead: these are
  -- a handful of rows per program, and correctness beats a single round trip.
  declare
    v_workout record;
    v_new_workout_id uuid;
  begin
    for v_workout in
      with referenced as (
        select distinct ws.workout_id as id
        from public.week_schedules ws
        left join public.program_phases ph on ph.id = ws.phase_id
        where (ws.program_id = p_program_id or ph.program_id = p_program_id)
          and ws.workout_id is not null
      ),
      -- A warmup is reachable only through the workout that links it, so pull
      -- those in too or the copy would point back at a template warmup.
      with_warmups as (
        select id from referenced
        union
        select w.warmup_id
        from public.workouts w
        join referenced r on r.id = w.id
        where w.warmup_id is not null
      )
      select w.* from public.workouts w join with_warmups ww on ww.id = w.id
    loop
      insert into public.workouts (
        name, description, estimated_duration_minutes, equipment, type, created_by, client_id
      )
      values (
        v_workout.name, v_workout.description, v_workout.estimated_duration_minutes,
        v_workout.equipment, v_workout.type, v_workout.created_by, p_client_id
      )
      returning id into v_new_workout_id;

      insert into _workout_map (old_id, new_id) values (v_workout.id, v_new_workout_id);
    end loop;
  end;

  -- Re-link each copied workout's warmup to the copied warmup.
  update public.workouts tgt
  set warmup_id = wm_warm.new_id
  from _workout_map wm_src
  join public.workouts src on src.id = wm_src.old_id
  join _workout_map wm_warm on wm_warm.old_id = src.warmup_id
  where tgt.id = wm_src.new_id and src.warmup_id is not null;

  insert into public.workout_exercises (
    workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select m.new_id, we.exercise_id, we.sort_order, we.mode, we.set_configs,
         we.rest_seconds, we.notes
  from public.workout_exercises we
  join _workout_map m on m.old_id = we.workout_id;

  -- Schedules last: they reference both the new phases and the new workouts.
  insert into public.week_schedules (program_id, phase_id, week_number, day_of_week, workout_id)
  select
    case when ws.program_id is not null then v_new_program_id else null end,
    pm.new_id,
    ws.week_number,
    ws.day_of_week,
    wm.new_id
  from public.week_schedules ws
  left join public.program_phases ph on ph.id = ws.phase_id
  left join _phase_map pm on pm.old_id = ws.phase_id
  left join _workout_map wm on wm.old_id = ws.workout_id
  where ws.program_id = p_program_id or ph.program_id = p_program_id;

  -- Sessions for the copy. The dual write: week_schedules above is still what
  -- everything reads, sessions is what everything will read.
  perform public.resync_program_sessions(v_new_program_id);

  return v_new_program_id;
end;
$$;

comment on function public.copy_program_tree(uuid, uuid, text) is
  'Deep-copies a program tree for one client: program, phases, the workouts its schedule references (plus their warmups, re-linked to the copies), those workouts'' exercise rows, and the schedule itself. `exercises` is shared reference data and is not copied. Also materializes the copy''s sessions — the dual write that keeps sessions current while reads still come from week_schedules. Internal: called by assign_program and duplicate_program only.';

-- ---------------------------------------------------------------------------
-- Backfill: every program that already exists
-- ---------------------------------------------------------------------------

do $$
declare
  v_program_id uuid;
begin
  for v_program_id in select id from public.programs loop
    perform public.resync_program_sessions(v_program_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_program: unchanged, plus a resync of the program it just wrote.
--
-- Without this, a program edited between here and the read cutover would keep
-- stale sessions and the edit would silently not appear once reads switch.
-- ---------------------------------------------------------------------------

create or replace function public.save_program(
  p_payload jsonb,
  p_program_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program_id uuid := p_program_id;
  v_current timestamptz;
  v_phased boolean := coalesce((p_payload->>'phased')::boolean, false);
  v_weeks int := (p_payload->>'weeks')::int;
  v_phase jsonb;
  v_index int := 0;
  v_phase_id uuid;
  v_phase_ids uuid[] := '{}';
  v_sort_orders int[] := '{}';
  v_slot jsonb;
begin
  if v_program_id is null then
    insert into public.programs (name, description, weeks, created_by)
    values (
      p_payload->>'name',
      nullif(p_payload->>'description', ''),
      v_weeks,
      auth.uid()
    )
    returning id into v_program_id;
  else
    -- SECURITY DEFINER bypasses RLS: scope by owner or any authenticated
    -- user could rewrite any coach's program by id.
    select updated_at into v_current
    from public.programs
    where id = v_program_id and created_by = auth.uid();

    if v_current is null then
      raise exception 'not_found_or_forbidden';
    end if;

    -- A client's copy has no safe editor yet; see the header.
    if (select client_id from public.programs where id = v_program_id) is not null then
      raise exception 'not_a_template';
    end if;
    if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
      raise exception 'stale_write';
    end if;

    update public.programs set
      name = p_payload->>'name',
      description = nullif(p_payload->>'description', ''),
      weeks = v_weeks
    where id = v_program_id;
  end if;

  -- Phases, reconciled by position. A phase that keeps its slot keeps its id,
  -- so its week_schedules rows survive with it.
  if v_phased then
    for v_phase in select * from jsonb_array_elements(coalesce(p_payload->'phases', '[]'::jsonb))
    loop
      update public.program_phases set
        name = nullif(v_phase->>'name', ''),
        weeks = (v_phase->>'weeks')::int,
        active_days = array(
          select jsonb_array_elements_text(coalesce(v_phase->'active_days', '[]'::jsonb))
        )::public.day_of_week[]
      where program_id = v_program_id and sort_order = v_index
      returning id into v_phase_id;

      if v_phase_id is null then
        insert into public.program_phases (program_id, name, sort_order, weeks, active_days)
        values (
          v_program_id,
          nullif(v_phase->>'name', ''),
          v_index,
          (v_phase->>'weeks')::int,
          array(
            select jsonb_array_elements_text(coalesce(v_phase->'active_days', '[]'::jsonb))
          )::public.day_of_week[]
        )
        returning id into v_phase_id;
      end if;

      v_phase_ids := array_append(v_phase_ids, v_phase_id);
      v_sort_orders := array_append(v_sort_orders, v_index);
      v_index := v_index + 1;
      v_phase_id := null;
    end loop;
  end if;

  -- Phases past the new end are genuinely gone (their schedules cascade).
  delete from public.program_phases
  where program_id = v_program_id and not (sort_order = any(v_sort_orders));

  -- Schedule slots. `slots` is a flat array of
  -- {phase_index?, week_number, day_of_week, workout_id} so both modes share
  -- one path; phase_index resolves against the phases just reconciled.
  for v_slot in select * from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb))
  loop
    if v_phased then
      v_phase_id := v_phase_ids[(v_slot->>'phase_index')::int + 1];
      if v_phase_id is null then
        continue; -- slot referenced a phase that no longer exists
      end if;

      update public.week_schedules set workout_id = (v_slot->>'workout_id')::uuid
      where phase_id = v_phase_id
        and week_number = (v_slot->>'week_number')::int
        and day_of_week = (v_slot->>'day_of_week')::public.day_of_week;

      if not found then
        insert into public.week_schedules (phase_id, week_number, day_of_week, workout_id)
        values (
          v_phase_id,
          (v_slot->>'week_number')::int,
          (v_slot->>'day_of_week')::public.day_of_week,
          (v_slot->>'workout_id')::uuid
        );
      end if;
    else
      update public.week_schedules set workout_id = (v_slot->>'workout_id')::uuid
      where program_id = v_program_id
        and week_number = (v_slot->>'week_number')::int
        and day_of_week = (v_slot->>'day_of_week')::public.day_of_week;

      if not found then
        insert into public.week_schedules (program_id, week_number, day_of_week, workout_id)
        values (
          v_program_id,
          (v_slot->>'week_number')::int,
          (v_slot->>'day_of_week')::public.day_of_week,
          (v_slot->>'workout_id')::uuid
        );
      end if;
    end if;
  end loop;

  -- Drop slots the payload no longer contains, in whichever scope applies.
  -- Switching modes leaves the other scope with no surviving rows, which is
  -- what clears it.
  delete from public.week_schedules ws
  where (
      (ws.program_id = v_program_id)
      or (ws.phase_id = any(v_phase_ids))
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb)) s
      where (s->>'week_number')::int = ws.week_number
        and (s->>'day_of_week')::public.day_of_week = ws.day_of_week
        and case
              when v_phased then v_phase_ids[(s->>'phase_index')::int + 1] = ws.phase_id
              else ws.program_id = v_program_id
            end
    );

  -- The dual write; see 0032's header.
  perform public.resync_program_sessions(v_program_id);

  return v_program_id;
end;
$$;

comment on function public.save_program(jsonb, uuid, timestamptz) is
  'RPC: creates or updates a LIBRARY program and reconciles its phases by (program_id, sort_order) and its schedule slots by (scope, week_number, day_of_week), instead of deleting and reinserting — so unchanged phases and slots keep their ids (R3). `slots` is a flat array carrying phase_index in phased mode, so both scopings share one path. p_expected_updated_at gives optimistic concurrency (C3). Refuses a program with client_id set: the only builder that calls this lists library workouts only, so saving a client''s copy from it would delete their schedule or repoint it at shared template rows. Also resyncs the program''s sessions — the dual write that keeps them current while reads still come from week_schedules. Raises: not_found_or_forbidden, not_a_template, stale_write.';

revoke execute on function public.save_program(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_program(jsonb, uuid, timestamptz) to authenticated;
