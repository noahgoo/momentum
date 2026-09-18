-- ---------------------------------------------------------------------------
-- 0028: teach the two write RPCs about is_valid_set_config (0027).
--
-- Split from 0027 so each migration lands one concern: 0027 adds the shape
-- check and the last_set_weights read, this one makes the writers respect it.
--
-- The two halves treat a violation differently, and the asymmetry is
-- tier-driven rather than incidental:
--
--   save_workout     rejects, with a domain code. set_configs is coach-authored
--                    template/instance data; the coach is at a desk and can
--                    retype it, and a silently-dropped field is the bug we are
--                    here to prevent.
--   save_workout_log nulls the bad snapshot and SAVES THE LOG. A log is an
--                    event row recording work a client actually did. Refusing
--                    it because its target snapshot was malformed would destroy
--                    the irreplaceable half to protect the replaceable one.
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
begin
  for v_exercise in select * from jsonb_array_elements(coalesce(p_payload->'exercises', '[]'::jsonb))
  loop
    if not public.is_valid_set_configs(coalesce(v_exercise->'set_configs', '[]'::jsonb)) then
      raise exception 'invalid_set_config';
    end if;
  end loop;

  if v_workout_id is null then
    insert into public.workouts (
      name, description, type, estimated_duration_minutes, equipment, warmup_id, created_by
    )
    values (
      p_payload->>'name',
      nullif(p_payload->>'description', ''),
      coalesce((p_payload->>'type')::public.workout_type, 'workout'),
      (p_payload->>'estimated_duration_minutes')::int,
      case when p_payload->'equipment' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(coalesce(p_payload->'equipment', '[]'::jsonb))) end,
      nullif(p_payload->>'warmup_id', '')::uuid,
      auth.uid()
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
      warmup_id = nullif(p_payload->>'warmup_id', '')::uuid
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
  'RPC: creates or updates a workout and its exercises in one transaction, reconciling workout_exercises by (workout_id, sort_order) so unchanged rows keep their ids (R3). Validates every set_configs element up front. p_expected_updated_at is optimistic concurrency (C3). Raises: not_found_or_forbidden, stale_write, invalid_set_config.';

revoke execute on function public.save_workout(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_workout(jsonb, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- save_workout_log: never lose a log over a bad snapshot
--
-- Unchanged from 0019 except that an invalid `prescribed` blob is written as
-- null instead of raising. The asymmetry with save_workout is deliberate and
-- tier-driven: set_configs is coach-authored template/instance data a coach
-- can retype, while a log is an event row recording work a client actually
-- did. Rejecting the whole log because its target snapshot was malformed
-- would destroy the irreplaceable half to protect the replaceable one.
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
  insert into public.workout_logs (client_id, date, workout_id, completed, completed_at)
  values (
    v_client_id,
    p_date,
    p_workout_id,
    p_completed,
    case when p_completed then now() else null end
  )
  on conflict (client_id, date) do update set
    workout_id = excluded.workout_id,
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
  'RPC: writes a client''s whole workout-log tree (log + exercise_logs + set_logs) in one transaction, snapshotting each exercise''s and set''s prescription. client_id is taken from auth.uid() and never as a parameter — a client logs only their own work. A malformed prescription snapshot is stored as null rather than rejected: the performance data is irreplaceable, the target snapshot is not. Refuses to CREATE a log for an unscheduled date (not_scheduled); an existing log stays editable. Never touches warmup_completed. Raises: forbidden, not_scheduled.';

revoke execute on function public.save_workout_log(date, uuid, boolean, jsonb) from public, anon;
grant execute on function public.save_workout_log(date, uuid, boolean, jsonb) to authenticated;
