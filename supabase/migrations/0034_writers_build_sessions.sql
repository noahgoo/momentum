-- ---------------------------------------------------------------------------
-- 0034: writers build sessions directly. The CONTRACT step.
--
-- 0032 had both writers keep week_schedules current and rebuild the program's
-- sessions wholesale after every save. That was safe only because nothing
-- edited a session. It stops being safe the moment the session editor ships,
-- and it is wrong on its own terms: re-saving a program with an unchanged
-- schedule threw away and rebuilt every session, so a per-day edit would not
-- have survived a coach reopening the program builder and pressing Save.
--
-- materialize_session is the replacement: it touches a session only when the
-- library workout behind that slot actually changed. A slot whose
-- source_workout_id already matches is left exactly as it is, edits included.
--
-- week_schedules is no longer written by anything, and nothing has read it
-- since 0033. It is dropped in 0035.
-- ---------------------------------------------------------------------------

create function public.materialize_session(
  p_program_id uuid,
  p_phase_id uuid,
  p_week_number int,
  p_day_of_week public.day_of_week,
  p_source_workout_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.sessions%rowtype;
  v_session_id uuid;
  v_warmup_id uuid;
begin
  select * into v_existing
  from public.sessions s
  where s.week_number = p_week_number
    and s.day_of_week = p_day_of_week
    and (
      (p_program_id is not null and s.program_id = p_program_id)
      or (p_phase_id is not null and s.phase_id = p_phase_id)
    );

  -- The slot already holds a session built from this workout. Leave it alone:
  -- its contents are the coach's, not the library's, and re-materializing
  -- would silently discard whatever they changed about that day.
  if v_existing.id is not null and v_existing.source_workout_id is not distinct from p_source_workout_id then
    return v_existing.id;
  end if;

  if v_existing.id is not null then
    delete from public.sessions where id = v_existing.id;
  end if;

  if p_source_workout_id is null then
    return null;
  end if;

  select w.warmup_id into v_warmup_id
  from public.workouts w where w.id = p_source_workout_id;

  -- Display fields are snapshotted, never joined live: renaming a library
  -- entry must not rename a day already scheduled for a client (R8).
  insert into public.sessions (
    program_id, phase_id, week_number, day_of_week,
    source_workout_id, name, description, estimated_duration_minutes, equipment,
    warmup_name, warmup_source_workout_id
  )
  select
    p_program_id, p_phase_id, p_week_number, p_day_of_week,
    w.id, w.name, w.description, w.estimated_duration_minutes, w.equipment,
    warm.name, warm.id
  from public.workouts w
  left join public.workouts warm on warm.id = w.warmup_id
  where w.id = p_source_workout_id
  returning id into v_session_id;

  insert into public.session_exercises (
    session_id, section, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select v_session_id, 'main'::public.session_section,
         we.exercise_id, we.sort_order, we.mode, we.set_configs, we.rest_seconds, we.notes
  from public.workout_exercises we
  where we.workout_id = p_source_workout_id;

  insert into public.session_exercises (
    session_id, section, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select v_session_id, 'warmup'::public.session_section,
         we.exercise_id, we.sort_order, we.mode, we.set_configs, we.rest_seconds, we.notes
  from public.workout_exercises we
  where v_warmup_id is not null and we.workout_id = v_warmup_id;

  return v_session_id;
end;
$$;

comment on function public.materialize_session(uuid, uuid, int, public.day_of_week, uuid) is
  'Ensures one program x week x day slot holds a session built from p_source_workout_id, flattening that workout''s warm-up into section=''warmup'' rows. IDEMPOTENT AND EDIT-PRESERVING: a slot already sourced from that workout is returned untouched, so re-saving a program never discards a coach''s per-day changes. Rebuilds only when the slot is empty or its source changed. NULL source clears the slot. Internal: called by save_program and copy_program_tree.';

revoke execute on function public.materialize_session(uuid, uuid, int, public.day_of_week, uuid) from public, anon, authenticated;

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

      perform public.materialize_session(
        null, v_phase_id,
        (v_slot->>'week_number')::int,
        (v_slot->>'day_of_week')::public.day_of_week,
        (v_slot->>'workout_id')::uuid
      );
    else
      perform public.materialize_session(
        v_program_id, null,
        (v_slot->>'week_number')::int,
        (v_slot->>'day_of_week')::public.day_of_week,
        (v_slot->>'workout_id')::uuid
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
  'RPC: creates or updates a LIBRARY program, reconciling its phases by (program_id, sort_order) and its sessions by (scope, week_number, day_of_week) instead of deleting and reinserting, so unchanged phases and slots keep their ids (R3). A slot whose library workout has not changed keeps its session untouched, edits included. `slots` is a flat array carrying phase_index in phased mode, so both scopings share one path. p_expected_updated_at gives optimistic concurrency (C3). Refuses a program with client_id set. Raises: not_found_or_forbidden, not_a_template, stale_write.';

revoke execute on function public.save_program(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_program(jsonb, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- copy_program_tree: a copy of sessions, and nothing else
--
-- Was ~110 lines: it copied the workouts a schedule referenced, one row at a
-- time through a temp id map, pulled in their warmups, re-linked each copy's
-- warmup_id to the copied warmup, copied workout_exercises, then remapped
-- week_schedules through both maps.
--
-- All of that existed because a schedule POINTED at a workout, so isolating
-- one client meant duplicating the library. Sessions already are the per-
-- client copy, so assigning is now: copy the program, copy its phases, copy
-- its sessions, copy their exercises. `_workout_map`, the per-row insert loop
-- and the warm-up re-link are gone, and an assign writes no workouts rows at
-- all — which is what makes "workouts is library-only" true by construction
-- rather than by discipline.
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

  -- Phases, keeping a map from old id to new so phase-scoped sessions can be
  -- remapped. Joined back on sort_order, which is unique within a program.
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

  -- Sessions, with a map of their own so their exercises can follow. Each
  -- one carries its snapshotted display fields across unchanged: the copy is
  -- of what the source session SAYS, so a coach's edit to a template day
  -- reaches the client they assign it to next, and no one already assigned.
  create temp table if not exists _session_map (old_id uuid, new_id uuid) on commit drop;
  delete from _session_map;

  declare
    v_session record;
    v_new_session_id uuid;
  begin
    for v_session in
      select s.*
      from public.sessions s
      left join public.program_phases ph on ph.id = s.phase_id
      where s.program_id = p_program_id or ph.program_id = p_program_id
    loop
      insert into public.sessions (
        program_id, phase_id, week_number, day_of_week,
        source_workout_id, name, description, estimated_duration_minutes, equipment,
        warmup_name, warmup_source_workout_id
      )
      values (
        case when v_session.program_id is not null then v_new_program_id else null end,
        (select new_id from _phase_map where old_id = v_session.phase_id),
        v_session.week_number,
        v_session.day_of_week,
        v_session.source_workout_id,
        v_session.name,
        v_session.description,
        v_session.estimated_duration_minutes,
        v_session.equipment,
        v_session.warmup_name,
        v_session.warmup_source_workout_id
      )
      returning id into v_new_session_id;

      insert into _session_map (old_id, new_id) values (v_session.id, v_new_session_id);
    end loop;
  end;

  -- `exercises` is shared reference data (name, video, defaults) and is NOT
  -- copied — the copies keep FKing into the same library rows.
  insert into public.session_exercises (
    session_id, section, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select m.new_id, se.section, se.exercise_id, se.sort_order, se.mode,
         se.set_configs, se.rest_seconds, se.notes
  from public.session_exercises se
  join _session_map m on m.old_id = se.session_id;

  return v_new_program_id;
end;
$$;

comment on function public.copy_program_tree(uuid, uuid, text) is
  'Deep-copies a program for one client: the program, its phases, its sessions and their exercise rows. Writes NO workouts rows — sessions are already the per-client copy, so the library is untouched by an assign. `exercises` is shared reference data and is not copied. Internal: called by assign_program and duplicate_program only.';

-- resync_program_sessions was the transitional dual-write helper (0032). It
-- rebuilt a program's sessions wholesale from week_schedules, which nothing
-- writes any more and which would now discard per-day edits.
drop function public.resync_program_sessions(uuid);
