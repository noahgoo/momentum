-- ---------------------------------------------------------------------------
-- 0042: a coach can restructure a client's own program.
--
-- Assigning deep-copies a program for one client (R1), so everything in that
-- copy is the coach's to change for that client: which days train, what each
-- day is, which week it falls in, how many weeks and phases there are, the
-- name. save_program refuses a copy (not_a_template) because it describes a
-- day only as "the library workout in this slot" — a day built freehand, edited
-- after assignment, or migrated without a library source has no such workout,
-- so a save through it would delete the day.
--
-- save_client_program describes a day by IDENTITY instead. Each slot in the
-- payload is one of:
--
--   {session_id}  keep this existing day, moving it to the slot's
--                 (phase, week, day) if that differs. Its exercises and every
--                 edit on it travel with it.
--   {workout_id}  a new day copied from a library workout (global, or on this
--                 client's shelf) — materialize_session, as assigning does.
--   {name}        a new blank day, to be filled in through the day editor.
--
-- A day the payload no longer mentions is deleted. Logs are Event tier and are
-- never touched: workout_logs.session_id is `on delete set null`, and the log
-- keeps its own session_name and prescription snapshots (R4, R8).
--
-- Moves and swaps are applied in two passes — every kept day is first parked
-- on a negative week number, then placed — because the (scope, week, day)
-- unique indexes are partial and so cannot be deferred.
-- ---------------------------------------------------------------------------

create function public.save_client_program(
  p_program_id uuid,
  p_payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.programs%rowtype;
  v_phased boolean := coalesce((p_payload->>'phased')::boolean, false);
  v_phase jsonb;
  v_phase_id uuid;
  v_phase_ids uuid[] := '{}';
  v_index int := 0;
  v_weeks int;
  v_scope_weeks int;
  v_slot jsonb;
  v_scope_program uuid;
  v_scope_phase uuid;
  v_session_id uuid;
  v_workout_id uuid;
  v_park int := 0;
begin
  -- SECURITY DEFINER bypasses RLS: ownership is checked here, through the
  -- program, exactly as save_program and save_session do.
  select * into v_program
  from public.programs
  where id = p_program_id and created_by = auth.uid();

  if v_program.id is null then
    raise exception 'not_found_or_forbidden';
  end if;
  if v_program.client_id is null then
    raise exception 'not_a_client_program';
  end if;
  if p_expected_updated_at is not null and v_program.updated_at <> p_expected_updated_at then
    raise exception 'stale_write';
  end if;

  -- ---- Phases, reconciled by id. A phase keeps its id across renames and
  -- reorders, so the days in it stay put unless a slot moves them.
  if v_phased then
    for v_phase in select * from jsonb_array_elements(coalesce(p_payload->'phases', '[]'::jsonb))
    loop
      if coalesce((v_phase->>'weeks')::int, 0) < 1 then
        raise exception 'invalid_payload';
      end if;
      v_phase_id := nullif(v_phase->>'id', '')::uuid;

      if v_phase_id is not null then
        update public.program_phases set
          name = nullif(v_phase->>'name', ''),
          weeks = (v_phase->>'weeks')::int,
          sort_order = v_index
        where id = v_phase_id and program_id = p_program_id;
        if not found then
          raise exception 'not_found_or_forbidden';
        end if;
      else
        insert into public.program_phases (program_id, name, sort_order, weeks)
        values (p_program_id, nullif(v_phase->>'name', ''), v_index, (v_phase->>'weeks')::int)
        returning id into v_phase_id;
      end if;

      v_phase_ids := array_append(v_phase_ids, v_phase_id);
      v_index := v_index + 1;
    end loop;

    if array_length(v_phase_ids, 1) is null then
      raise exception 'invalid_payload';
    end if;
    select sum(weeks) into v_weeks from public.program_phases where id = any(v_phase_ids);
  else
    v_weeks := (p_payload->>'weeks')::int;
  end if;

  if v_weeks is null or v_weeks < 1 then
    raise exception 'invalid_payload';
  end if;

  -- ---- Validate every slot before writing any day.
  for v_slot in select * from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb))
  loop
    -- A day must land inside its scope: phase-local weeks when phased (R5's
    -- flattening sums phase lengths), global weeks when flat.
    v_scope_weeks := v_weeks;
    if v_phased then
      select ph.weeks into v_scope_weeks
      from public.program_phases ph
      where ph.id = v_phase_ids[(v_slot->>'phase_index')::int + 1];
    end if;

    if v_scope_weeks is null
       or (v_slot->>'week_number')::int < 1
       or (v_slot->>'week_number')::int > v_scope_weeks then
      raise exception 'invalid_payload';
    end if;

    v_session_id := nullif(v_slot->>'session_id', '')::uuid;
    v_workout_id := nullif(v_slot->>'workout_id', '')::uuid;

    if v_session_id is not null then
      -- Only a day already in THIS program can be kept or moved; anything
      -- else would let a payload pull another client's day in by id.
      if not exists (
        select 1 from public.sessions s
        left join public.program_phases ph on ph.id = s.phase_id
        where s.id = v_session_id
          and (s.program_id = p_program_id or ph.program_id = p_program_id)
      ) then
        raise exception 'not_found_or_forbidden';
      end if;
    elsif v_workout_id is not null then
      -- materialize_session does not re-check ownership. A coach may copy in
      -- only a workout they authored, and only from the global library or
      -- this client's own shelf.
      if not exists (
        select 1 from public.workouts w
        where w.id = v_workout_id
          and w.created_by = auth.uid()
          and (w.client_id is null or w.client_id = v_program.client_id)
      ) then
        raise exception 'not_found_or_forbidden';
      end if;
    elsif coalesce(btrim(v_slot->>'name'), '') = '' then
      raise exception 'invalid_payload';
    end if;
  end loop;

  -- Two slots on one day, or one day kept twice, is a client bug.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb)) s
    group by coalesce(s->>'phase_index', ''), s->>'week_number', s->>'day_of_week'
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb)) s
    where s->>'session_id' is not null
    group by s->>'session_id'
    having count(*) > 1
  ) then
    raise exception 'duplicate_slot';
  end if;

  -- ---- Drop the days the payload no longer mentions. Logs keep their row
  -- (session_id set null); a schedule-move override onto the day cascades
  -- away, restoring the computed schedule for that date.
  delete from public.sessions s
  where (
      s.program_id = p_program_id
      or s.phase_id in (select ph.id from public.program_phases ph where ph.program_id = p_program_id)
    )
    and s.id not in (
      select (e->>'session_id')::uuid
      from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb)) e
      where e->>'session_id' is not null
    );

  -- ---- Pass 1: park every kept day in its new scope on a unique negative
  -- week, so a swap never collides with the day it is swapping with.
  for v_slot in
    select e from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb)) e
    where e->>'session_id' is not null
  loop
    v_park := v_park - 1;
    if v_phased then
      v_scope_program := null;
      v_scope_phase := v_phase_ids[(v_slot->>'phase_index')::int + 1];
    else
      v_scope_program := p_program_id;
      v_scope_phase := null;
    end if;

    update public.sessions set
      program_id = v_scope_program,
      phase_id = v_scope_phase,
      week_number = v_park
    where id = (v_slot->>'session_id')::uuid;
  end loop;

  -- Phases no longer in the payload are empty now (their kept days were just
  -- moved out, the rest deleted above), so removing them loses nothing. In
  -- flat mode v_phase_ids is empty, so this clears every phase.
  delete from public.program_phases
  where program_id = p_program_id and not (id = any(v_phase_ids));

  -- ---- Pass 2: place kept days, then create new ones.
  for v_slot in select * from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb))
  loop
    if v_phased then
      v_scope_program := null;
      v_scope_phase := v_phase_ids[(v_slot->>'phase_index')::int + 1];
    else
      v_scope_program := p_program_id;
      v_scope_phase := null;
    end if;

    v_session_id := nullif(v_slot->>'session_id', '')::uuid;
    v_workout_id := nullif(v_slot->>'workout_id', '')::uuid;

    if v_session_id is not null then
      update public.sessions set
        week_number = (v_slot->>'week_number')::int,
        day_of_week = (v_slot->>'day_of_week')::public.day_of_week
      where id = v_session_id;
    elsif v_workout_id is not null then
      perform public.materialize_session(
        v_scope_program, v_scope_phase,
        (v_slot->>'week_number')::int,
        (v_slot->>'day_of_week')::public.day_of_week,
        v_workout_id
      );
    else
      insert into public.sessions (program_id, phase_id, week_number, day_of_week, name)
      values (
        v_scope_program, v_scope_phase,
        (v_slot->>'week_number')::int,
        (v_slot->>'day_of_week')::public.day_of_week,
        btrim(v_slot->>'name')
      );
    end if;
  end loop;

  -- active_days is display metadata for a phase; keep it true to its days.
  update public.program_phases ph set
    active_days = coalesce((
      select array_agg(distinct s.day_of_week order by s.day_of_week)
      from public.sessions s where s.phase_id = ph.id
    ), '{}')
  where ph.program_id = p_program_id;

  update public.programs set
    name = coalesce(nullif(btrim(p_payload->>'name'), ''), name),
    description = nullif(p_payload->>'description', ''),
    weeks = v_weeks
  where id = p_program_id;

  -- client_summaries.today_workout_name derives from the schedule, and no
  -- trigger watches sessions (C2).
  perform public.refresh_client_summary(v_program.client_id);

  return p_program_id;
end;
$$;

comment on function public.save_client_program(uuid, jsonb, timestamptz) is
  'RPC: restructures ONE CLIENT''S program copy (programs.client_id set): name, weeks, phases (reconciled by id), and its days. Each slot keeps an existing day by session_id (moving it if its phase/week/day changed, contents untouched), copies a new day from a library workout the coach authored (global or this client''s shelf), or creates a blank named day. Days not in the payload are deleted; logs survive via session_id set null and their own snapshots (R4, R8). Moves and swaps go through a negative-week parking pass because the slot unique indexes cannot be deferred. Refreshes the client''s summary (C2). p_expected_updated_at gives optimistic concurrency (C3). Raises: not_found_or_forbidden, not_a_client_program, stale_write, invalid_payload, duplicate_slot.';

revoke execute on function public.save_client_program(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.save_client_program(uuid, jsonb, timestamptz) to authenticated;
