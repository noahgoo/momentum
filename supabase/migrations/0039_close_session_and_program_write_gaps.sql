-- ---------------------------------------------------------------------------
-- 0039: close four gaps found reviewing 0030-0038.
--
-- 1. save_program passed a slot's client-submitted workout_id straight to
--    materialize_session with no check that the caller's coach owns that
--    workout. workouts_coach_all scopes a coach to their own rows only --
--    workouts are not a shared library -- but materialize_session is
--    SECURITY DEFINER and, like copy_program_tree, trusts its caller rather
--    than re-checking; save_program is where that trust has to be earned.
--    Any coach who learned another coach's workout id (including a
--    client-scoped one) could pull its full contents -- name, description,
--    every exercise -- into their own program, edit it, and hand it to
--    their own clients. The check belongs in save_program, not
--    materialize_session itself: seed.sql and half the test suite call
--    materialize_session directly as a trusted fixture-builder with no
--    auth.uid() in scope, exactly like copy_program_tree.
--
-- 2. save_program's not_a_template guard lives in the RPC, not in RLS.
--    programs_coach_all and program_phases_coach_all allow `update` on any
--    row the coach authored, template or instance, so a direct
--    supabase.from("programs").update(...) call -- already a pattern this
--    codebase uses elsewhere (useDeleteProgram) -- reaches a client's
--    assigned program without ever calling save_program. RLS is supposed
--    to be what makes this impossible, not the RPC layer alone.
--
-- 3. save_workout_log only checked that *some* session was scheduled on the
--    date, never that the client-submitted p_workout_id was that session
--    (or the session already on file for an edited log). The session_name
--    snapshot it added reads `sessions` unscoped inside a SECURITY DEFINER
--    function, so a client could submit a foreign session id on any date
--    they have a schedule and read that session's name into their own log.
--
-- 4. save_workout's update branch always overwrote client_id from the
--    payload, including when the payload omits the key entirely. Every
--    current caller omits it, so any future edit path that saves a
--    client-scoped workout without threading client_id through would
--    silently promote it back to the global library -- a write meant for
--    one client reaching everyone, the exact failure mode the tier model
--    exists to prevent.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. save_program: verify the caller owns a slot's workout before it is
--    ever handed to materialize_session
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
  v_slot_workout_id uuid;
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
    v_slot_workout_id := (v_slot->>'workout_id')::uuid;

    -- materialize_session trusts its caller and does not re-check ownership
    -- (it is also called directly by fixtures with no auth.uid() in scope,
    -- like copy_program_tree), so the library-row boundary has to be
    -- enforced here: a coach may only schedule a workout they themselves
    -- authored, never one belonging to another coach whose full contents
    -- materialize_session would otherwise copy in on their behalf.
    if v_slot_workout_id is not null and not exists (
      select 1 from public.workouts w
      where w.id = v_slot_workout_id and w.created_by = auth.uid()
    ) then
      raise exception 'not_found_or_forbidden';
    end if;

    if v_phased then
      v_phase_id := v_phase_ids[(v_slot->>'phase_index')::int + 1];
      if v_phase_id is null then
        continue; -- slot referenced a phase that no longer exists
      end if;

      perform public.materialize_session(
        null, v_phase_id,
        (v_slot->>'week_number')::int,
        (v_slot->>'day_of_week')::public.day_of_week,
        v_slot_workout_id
      );
    else
      perform public.materialize_session(
        v_program_id, null,
        (v_slot->>'week_number')::int,
        (v_slot->>'day_of_week')::public.day_of_week,
        v_slot_workout_id
      );
    end if;
  end loop;

  -- Drop slots the payload no longer contains, in whichever scope applies.
  -- Switching modes leaves the other scope with no surviving rows, which is
  -- what clears it.
  delete from public.sessions ws
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

  return v_program_id;
end;
$$;
comment on function public.save_program(jsonb, uuid, timestamptz) is
  'RPC: creates or updates a LIBRARY program, reconciling its phases by (program_id, sort_order) and its sessions by (scope, week_number, day_of_week) instead of deleting and reinserting, so unchanged phases and slots keep their ids (R3). A slot whose library workout has not changed keeps its session untouched, edits included. Every slot''s workout_id must belong to the calling coach -- materialize_session does not re-check this itself. `slots` is a flat array carrying phase_index in phased mode, so both scopings share one path. p_expected_updated_at gives optimistic concurrency (C3). Refuses a program with client_id set. Raises: not_found_or_forbidden, not_a_template, stale_write.';

-- ---------------------------------------------------------------------------
-- 2. RLS: an instance program can no longer be rewritten by a raw update.
--
-- Split the single `for all` policy so select/insert/delete keep today's
-- behavior and update alone gains `client_id is null`. Every legitimate
-- writer of a program or its phases (save_program, copy_program_tree,
-- assign_program, materialize_session) is SECURITY DEFINER and so is
-- unaffected by RLS either way; this closes only the path where a coach's
-- own supabase-js client updates the row directly.
-- ---------------------------------------------------------------------------

drop policy programs_coach_all on public.programs;

create policy programs_coach_select
  on public.programs for select
  using (created_by = (select auth.uid()));

create policy programs_coach_insert
  on public.programs for insert
  with check (created_by = (select auth.uid()));

create policy programs_coach_update
  on public.programs for update
  using (created_by = (select auth.uid()) and client_id is null)
  with check (created_by = (select auth.uid()) and client_id is null);

create policy programs_coach_delete
  on public.programs for delete
  using (created_by = (select auth.uid()));

comment on policy programs_coach_select on public.programs is 'Coach can read any program, template or instance, they authored.';
comment on policy programs_coach_insert on public.programs is 'Coach can create a program under their own id. Instance copies come from copy_program_tree, which is SECURITY DEFINER and bypasses this.';
comment on policy programs_coach_update on public.programs is 'Coach can update only their own TEMPLATE programs directly. An instance program (client_id set) is restructured only through save_program''s not_a_template guard and other SECURITY DEFINER RPCs -- this is what makes that guard hold even against a raw update.';
comment on policy programs_coach_delete on public.programs is 'Coach full delete on programs they authored, template or instance.';

drop policy program_phases_coach_all on public.program_phases;

create policy program_phases_coach_select
  on public.program_phases for select
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id and p.created_by = (select auth.uid())
    )
  );

create policy program_phases_coach_insert
  on public.program_phases for insert
  with check (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id and p.created_by = (select auth.uid())
    )
  );

create policy program_phases_coach_update
  on public.program_phases for update
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id
        and p.created_by = (select auth.uid()) and p.client_id is null
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id
        and p.created_by = (select auth.uid()) and p.client_id is null
    )
  );

create policy program_phases_coach_delete
  on public.program_phases for delete
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id and p.created_by = (select auth.uid())
    )
  );

comment on policy program_phases_coach_select on public.program_phases is 'Coach can read phases of any program, template or instance, they authored.';
comment on policy program_phases_coach_insert on public.program_phases is 'Coach can add phases to a program they authored. Instance phases come from copy_program_tree (SECURITY DEFINER).';
comment on policy program_phases_coach_update on public.program_phases is 'Coach can update phases of their own TEMPLATE programs only, matching programs_coach_update.';
comment on policy program_phases_coach_delete on public.program_phases is 'Coach full delete on phases of programs they authored, template or instance.';

-- ---------------------------------------------------------------------------
-- 3. save_workout_log: the submitted session id must be the one scheduled,
--    or the one already on this log -- never an arbitrary third session.
-- ---------------------------------------------------------------------------

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
  v_log_exists boolean;
  v_existing_session_id uuid;
  v_resolved_session_id uuid;
  v_exercise jsonb;
  v_exercise_log_id uuid;
  v_set jsonb;
  v_prescribed jsonb;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  select true, session_id into v_log_exists, v_existing_session_id
  from public.workout_logs
  where client_id = v_client_id and date = p_date;
  v_log_exists := coalesce(v_log_exists, false);

  v_resolved_session_id := public.resolve_scheduled_workout(v_client_id, p_date);

  -- A log may only be CREATED for a date that actually has a workout.
  if not v_log_exists and v_resolved_session_id is null then
    raise exception 'not_scheduled';
  end if;

  -- p_workout_id must be the session actually scheduled today, or -- for an
  -- already-existing log -- the session that was on it before, so editing a
  -- log survives a later reschedule (the client did the work; the record
  -- stays). Anything else is a foreign session id the caller has no claim to,
  -- which the raw ownerless lookup below would otherwise happily disclose.
  if p_workout_id is distinct from v_resolved_session_id
     and (not v_log_exists or p_workout_id is distinct from v_existing_session_id) then
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

comment on function public.save_workout_log(date, uuid, boolean, jsonb) is
  'RPC: creates or updates a client''s own workout log for a date, replacing its exercise/set children wholesale in one transaction. p_workout_id (a SESSION id; name kept for older mobile builds) must equal the session scheduled for that date, or the session already on the existing log for that date -- anything else is a foreign session id and is refused. Raises: forbidden, not_scheduled.';

-- ---------------------------------------------------------------------------
-- 4. save_workout: omitting client_id from the payload must not clear it.
-- ---------------------------------------------------------------------------

create or replace function public.save_workout(
  p_payload jsonb,
  p_workout_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workout_id uuid := p_workout_id;
  v_current timestamptz;
  v_exercise jsonb;
  v_index int := 0;
  v_keep int[] := '{}';
  v_client_id uuid := nullif(p_payload->>'client_id', '')::uuid;
begin
  -- A client-scoped library workout appears only in that client's picker, so
  -- filing one under someone else's client would leak it there.
  if v_client_id is not null and not public.is_coach_of(v_client_id) then
    raise exception 'not_your_client';
  end if;

  for v_exercise in select * from jsonb_array_elements(coalesce(p_payload->'exercises', '[]'::jsonb))
  loop
    if not public.is_valid_set_configs(coalesce(v_exercise->'set_configs', '[]'::jsonb)) then
      raise exception 'invalid_set_config';
    end if;
  end loop;

  if v_workout_id is null then
    insert into public.workouts (
      name, description, category, type, estimated_duration_minutes, equipment,
      warmup_id, created_by, client_id, source_workout_id
    )
    values (
      p_payload->>'name',
      nullif(p_payload->>'description', ''),
      nullif(p_payload->>'category', ''),
      coalesce((p_payload->>'type')::public.workout_type, 'workout'),
      (p_payload->>'estimated_duration_minutes')::int,
      case when p_payload->'equipment' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(coalesce(p_payload->'equipment', '[]'::jsonb))) end,
      nullif(p_payload->>'warmup_id', '')::uuid,
      auth.uid(),
      v_client_id,
      nullif(p_payload->>'source_workout_id', '')::uuid
    )
    returning id into v_workout_id;
  else
    -- SECURITY DEFINER bypasses RLS, so ownership must be checked here or
    -- any authenticated user could rewrite any workout by id. Scoping the
    -- lookup itself (rather than a separate check) means a future edit
    -- cannot leave the update reachable without it.
    select updated_at into v_current
    from public.workouts
    where id = v_workout_id and created_by = auth.uid();

    if v_current is null then
      raise exception 'not_found_or_forbidden';
    end if;
    if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
      raise exception 'stale_write';
    end if;

    update public.workouts set
      name = p_payload->>'name',
      description = nullif(p_payload->>'description', ''),
      type = coalesce((p_payload->>'type')::public.workout_type, 'workout'),
      estimated_duration_minutes = (p_payload->>'estimated_duration_minutes')::int,
      equipment = case when p_payload->'equipment' = 'null'::jsonb then null
                       else array(select jsonb_array_elements_text(coalesce(p_payload->'equipment', '[]'::jsonb))) end,
      warmup_id = nullif(p_payload->>'warmup_id', '')::uuid,
      category = nullif(p_payload->>'category', ''),
      -- Only touch client_id when the payload actually carries the key.
      -- Every current caller omits it on edit; defaulting a missing key to
      -- "clear it" would re-share a client-filed workout into the global
      -- library the moment an edit path threads a payload without it.
      client_id = case when p_payload ? 'client_id' then v_client_id else client_id end
    where id = v_workout_id;
  end if;

  -- Upsert each exercise in place, keyed by its position in the workout.
  for v_exercise in select * from jsonb_array_elements(coalesce(p_payload->'exercises', '[]'::jsonb))
  loop
    update public.workout_exercises set
      exercise_id = nullif(v_exercise->>'exercise_id', '')::uuid,
      mode = coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
      set_configs = coalesce(v_exercise->'set_configs', '[]'::jsonb),
      rest_seconds = (v_exercise->>'rest_seconds')::int,
      notes = nullif(v_exercise->>'notes', '')
    where workout_id = v_workout_id and sort_order = v_index;

    if not found then
      insert into public.workout_exercises (
        workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
      )
      values (
        v_workout_id,
        nullif(v_exercise->>'exercise_id', '')::uuid,
        v_index,
        coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
        coalesce(v_exercise->'set_configs', '[]'::jsonb),
        (v_exercise->>'rest_seconds')::int,
        nullif(v_exercise->>'notes', '')
      );
    end if;

    v_keep := array_append(v_keep, v_index);
    v_index := v_index + 1;
  end loop;

  -- Only rows past the new end are actually gone.
  delete from public.workout_exercises
  where workout_id = v_workout_id and sort_order >= v_index;

  return v_workout_id;
end;
$$;
comment on function public.save_workout(jsonb, uuid, timestamptz) is
  'RPC: creates or updates a LIBRARY workout and its exercises in one transaction, reconciling workout_exercises by (workout_id, sort_order) so unchanged rows keep their ids (R3). Validates every set_configs element up front. `client_id` in the payload files the workout under one client, who must be the caller''s; omitting the key on an update leaves the workout''s existing scope untouched. p_expected_updated_at is optimistic concurrency (C3). Raises: not_found_or_forbidden, not_your_client, stale_write, invalid_set_config.';
