-- ---------------------------------------------------------------------------
-- 0037: editing one day, and pushing that edit forward.
--
-- A session already owns its exercises, so editing week 3 touches week 3 and
-- nothing else — that is free, and it is the default. What this adds is the
-- two things a coach wants to do *with* such an edit:
--
--   save_session_as_workout   file it in the library, globally or under this
--                             one client, so it can be picked again
--   apply_session_to_future   push it onto the client's LATER days that came
--                             from the same workout
--
-- The fan-out is explicit and opt-in. data-model.md is clear that pushing a
-- change beyond the row in hand is a deliberate action, never a side effect
-- of saving.
-- ---------------------------------------------------------------------------

create function public.save_session(
  p_payload jsonb,
  p_session_id uuid,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current timestamptz;
  v_exercise jsonb;
  v_index int;
  v_section public.session_section;
begin
  for v_exercise in select * from jsonb_array_elements(coalesce(p_payload->'exercises', '[]'::jsonb))
  loop
    if not public.is_valid_set_configs(coalesce(v_exercise->'set_configs', '[]'::jsonb)) then
      raise exception 'invalid_set_config';
    end if;
  end loop;

  -- SECURITY DEFINER bypasses RLS, so ownership is checked here or any
  -- authenticated user could rewrite any client's day by id. Ownership flows
  -- through the program, exactly as the sessions policies express it.
  select s.updated_at into v_current
  from public.sessions s
  left join public.programs p on p.id = s.program_id
  left join public.program_phases ph on ph.id = s.phase_id
  left join public.programs pp on pp.id = ph.program_id
  where s.id = p_session_id
    and coalesce(p.created_by, pp.created_by) = auth.uid();

  if v_current is null then
    raise exception 'not_found_or_forbidden';
  end if;
  if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
    raise exception 'stale_write';
  end if;

  update public.sessions set
    name = coalesce(p_payload->>'name', name),
    description = nullif(p_payload->>'description', ''),
    estimated_duration_minutes = (p_payload->>'estimated_duration_minutes')::int,
    warmup_name = nullif(p_payload->>'warmup_name', '')
  where id = p_session_id;

  -- Reconciled by (session_id, section, sort_order) rather than replaced
  -- wholesale, so an unchanged row keeps its id (R3).
  for v_section in select unnest(enum_range(null::public.session_section))
  loop
    v_index := 0;
    for v_exercise in
      select e from jsonb_array_elements(coalesce(p_payload->'exercises', '[]'::jsonb)) e
      where e->>'section' = v_section::text
    loop
      update public.session_exercises set
        exercise_id = nullif(v_exercise->>'exercise_id', '')::uuid,
        mode = coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
        set_configs = coalesce(v_exercise->'set_configs', '[]'::jsonb),
        rest_seconds = (v_exercise->>'rest_seconds')::int,
        notes = nullif(v_exercise->>'notes', '')
      where session_id = p_session_id and section = v_section and sort_order = v_index;

      if not found then
        insert into public.session_exercises (
          session_id, section, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
        )
        values (
          p_session_id, v_section,
          nullif(v_exercise->>'exercise_id', '')::uuid,
          v_index,
          coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
          coalesce(v_exercise->'set_configs', '[]'::jsonb),
          (v_exercise->>'rest_seconds')::int,
          nullif(v_exercise->>'notes', '')
        );
      end if;

      v_index := v_index + 1;
    end loop;

    delete from public.session_exercises
    where session_id = p_session_id and section = v_section and sort_order >= v_index;
  end loop;

  return p_session_id;
end;
$$;

comment on function public.save_session(jsonb, uuid, timestamptz) is
  'RPC: updates one scheduled day and its exercises in one transaction, reconciling session_exercises by (session_id, section, sort_order) so unchanged rows keep their ids (R3). Touches exactly one day — no other week, no other client, and never the library workout it came from. p_expected_updated_at is optimistic concurrency (C3). Raises: not_found_or_forbidden, stale_write, invalid_set_config.';

revoke execute on function public.save_session(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_session(jsonb, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- save_session_as_workout
-- ---------------------------------------------------------------------------

create function public.save_session_as_workout(
  p_session_id uuid,
  p_client_id uuid default null,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_owner uuid;
  v_new_id uuid;
  v_warmup_id uuid;
  v_category text;
begin
  -- A %rowtype cannot share an INTO list with another target, so the owner
  -- is looked up separately.
  select * into v_session from public.sessions where id = p_session_id;

  select coalesce(p.created_by, pp.created_by) into v_owner
  from public.sessions s
  left join public.programs p on p.id = s.program_id
  left join public.program_phases ph on ph.id = s.phase_id
  left join public.programs pp on pp.id = ph.program_id
  where s.id = p_session_id;

  if v_session.id is null or v_owner is distinct from auth.uid() then
    raise exception 'not_found_or_forbidden';
  end if;
  if p_client_id is not null and not public.is_coach_of(p_client_id) then
    raise exception 'not_your_client';
  end if;

  select category into v_category
  from public.workouts where id = v_session.source_workout_id;

  -- A customized warm-up is promoted to its own library entry rather than
  -- silently dropped back to whatever the original warm-up was.
  if exists (
    select 1 from public.session_exercises
    where session_id = p_session_id and section = 'warmup'
  ) then
    insert into public.workouts (name, type, created_by, client_id, source_workout_id)
    values (
      coalesce(v_session.warmup_name, coalesce(p_name, v_session.name) || ' warm-up'),
      'warmup', auth.uid(), p_client_id, v_session.warmup_source_workout_id
    )
    returning id into v_warmup_id;

    insert into public.workout_exercises (
      workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
    )
    select v_warmup_id, se.exercise_id, se.sort_order, se.mode, se.set_configs,
           se.rest_seconds, se.notes
    from public.session_exercises se
    where se.session_id = p_session_id and se.section = 'warmup';
  end if;

  insert into public.workouts (
    name, description, category, estimated_duration_minutes, equipment, type,
    warmup_id, created_by, client_id, source_workout_id
  )
  values (
    coalesce(nullif(p_name, ''), v_session.name),
    v_session.description, v_category, v_session.estimated_duration_minutes,
    v_session.equipment, 'workout', v_warmup_id, auth.uid(), p_client_id,
    v_session.source_workout_id
  )
  returning id into v_new_id;

  insert into public.workout_exercises (
    workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select v_new_id, se.exercise_id, se.sort_order, se.mode, se.set_configs,
         se.rest_seconds, se.notes
  from public.session_exercises se
  where se.session_id = p_session_id and se.section = 'main';

  return v_new_id;
end;
$$;

comment on function public.save_session_as_workout(uuid, uuid, text) is
  'RPC: files one scheduled day in the library as a reusable workout, globally (p_client_id null) or under one client. Copies the day''s main exercises, and promotes a customized warm-up to its own type=''warmup'' entry rather than dropping it back to the original. source_workout_id records which library entry the day descended from. The session itself is untouched. Raises: not_found_or_forbidden, not_your_client.';

revoke execute on function public.save_session_as_workout(uuid, uuid, text) from public, anon;
grant execute on function public.save_session_as_workout(uuid, uuid, text) to authenticated;
