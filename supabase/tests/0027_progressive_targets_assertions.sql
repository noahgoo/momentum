-- Assertions for per-side reps, progressive targets, and the set_configs shape
-- check (migrations 0027 + 0028).
--
-- Three things worth proving, because each fails silently otherwise:
--   1. is_valid_set_config's truth table, including that JSON null counts as
--      absent (the seed ships explicit nulls) and that a MISSING key does not
--      make the whole check evaluate to NULL.
--   2. last_set_weights resolves per EXERCISE, not per session, and skips sets
--      the client never typed a weight into (P2).
--   3. The two writers disagree on purpose: save_workout rejects a malformed
--      prescription, save_workout_log keeps the log and nulls the snapshot.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0027_progressive_targets_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id uuid := 'de000000-0000-0000-0000-000000000001';
  client_a uuid := 'de000000-0000-0000-0000-00000000000a';

  w_push   uuid := 'df000000-0000-0000-0000-000000000001';
  ex_squat uuid := 'ef000000-0000-0000-0000-000000000001';
  ex_bench uuid := 'ef000000-0000-0000-0000-000000000002';
  ex_row   uuid := 'ef000000-0000-0000-0000-000000000003';
  prog_id  uuid := 'ff000000-0000-0000-0000-000000000001';

  v_start date := date_trunc('week', current_date)::date;
  v_today date := v_start + 3;   -- Thursday of the active week

  log_old  uuid;
  log_mid  uuid;
  el_id    uuid;
  v_day    jsonb;
  v_last   jsonb;
  v_new_id uuid;
  v_count  int;
  v_sqlstate text;

  -- One row per case; `expected` is what is_valid_set_config must return.
  cases jsonb := '[
    {"label":"seed shape with explicit nulls","expected":true,
     "cfg":{"reps":10,"weight":null,"weight_unit":null}},
    {"label":"reps only","expected":true,"cfg":{"reps":10}},
    {"label":"fixed weight with unit","expected":true,
     "cfg":{"reps":8,"weight":95,"weight_unit":"lbs"}},
    {"label":"time mode","expected":true,"cfg":{"seconds":45}},
    {"label":"distance mode","expected":true,"cfg":{"miles":2,"pace_seconds":540}},
    {"label":"per_side","expected":true,"cfg":{"reps":10,"per_side":true}},
    {"label":"increment","expected":true,
     "cfg":{"reps":8,"weight_delta":5,"weight_unit":"lbs"}},
    {"label":"negative increment","expected":true,
     "cfg":{"reps":8,"weight_delta":-5,"weight_unit":"lbs"}},
    {"label":"zero increment","expected":true,
     "cfg":{"reps":8,"weight_delta":0,"weight_unit":"lbs"}},
    {"label":"weight AND delta together is legal","expected":true,
     "cfg":{"reps":8,"weight":95,"weight_delta":5,"weight_unit":"lbs"}},
    {"label":"empty object","expected":true,"cfg":{}},
    {"label":"unknown key","expected":false,"cfg":{"reps":8,"per_sides":true}},
    {"label":"weight as string","expected":false,
     "cfg":{"reps":8,"weight":"95","weight_unit":"lbs"}},
    {"label":"weight without unit (P6)","expected":false,"cfg":{"reps":8,"weight":95}},
    {"label":"delta without unit (P6)","expected":false,"cfg":{"reps":8,"weight_delta":5}},
    {"label":"per_side as string","expected":false,"cfg":{"reps":8,"per_side":"yes"}},
    {"label":"bogus weight_unit","expected":false,
     "cfg":{"reps":8,"weight":95,"weight_unit":"stone"}},
    {"label":"array not object","expected":false,"cfg":[]},
    {"label":"scalar not object","expected":false,"cfg":5}
  ]'::jsonb;
  c jsonb;
  v_actual boolean;
begin
  -- ---------------------------------------------------------------------
  -- 1. is_valid_set_config truth table
  -- ---------------------------------------------------------------------
  for c in select * from jsonb_array_elements(cases)
  loop
    v_actual := public.is_valid_set_config(c->'cfg');
    -- `is distinct from` so a NULL result is caught as a failure rather than
    -- quietly passing: a missing-key comparison that yields NULL is the exact
    -- bug this check exists to prevent.
    if v_actual is distinct from (c->>'expected')::boolean then
      failures := array_append(failures,
        format('is_valid_set_config(%s) [%s] = %s, expected %s',
               c->'cfg', c->>'label', coalesce(v_actual::text,'NULL'), c->>'expected'));
    end if;
  end loop;

  if public.is_valid_set_configs('[]'::jsonb) is not true then
    failures := array_append(failures, 'an empty set_configs array should be valid');
  end if;
  if public.is_valid_set_configs('[{"reps":8},{"reps":8,"nope":1}]'::jsonb) is not false then
    failures := array_append(failures, 'one bad element should invalidate the whole array');
  end if;
  if public.is_valid_set_configs('{"reps":8}'::jsonb) is not false then
    failures := array_append(failures, 'a bare object is not a valid set_configs array');
  end if;

  -- ---------------------------------------------------------------------
  -- Fixtures
  -- ---------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (coach_id, 'prog-coach@test.local', jsonb_build_object('role','coach','display_name','Prog Coach')),
    (client_a, 'prog-client@test.local',
      jsonb_build_object('role','client','display_name','Prog Client','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values
    (ex_squat, 'Back Squat', coach_id),
    (ex_bench, 'Bench Press', coach_id),
    (ex_row,   'Barbell Row', coach_id);

  insert into public.workouts (id, name, type, created_by)
    values (w_push, 'Push', 'workout', coach_id);

  -- Squat progresses off the last logged weight; bench is a fixed target.
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
    values (w_push, ex_squat, 0, 'reps',
      '[{"reps":5,"weight_delta":5,"weight_unit":"lbs"},
        {"reps":5,"weight_delta":5,"weight_unit":"lbs"},
        {"reps":5,"weight_delta":5,"weight_unit":"lbs"}]'::jsonb);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
    values (w_push, ex_bench, 1, 'reps',
      '[{"reps":10,"weight":95,"weight_unit":"lbs","per_side":true}]'::jsonb);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
    values (w_push, ex_row, 2, 'reps',
      '[{"reps":8,"weight_delta":5,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (prog_id, 'Prog', 8, coach_id);
  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id) values
    (prog_id, 1, 'monday', w_push),
    (prog_id, 1, 'tuesday', w_push),
    (prog_id, 1, 'wednesday', w_push),
    (prog_id, 1, 'thursday', w_push);
  insert into public.assignments (client_id, program_id, start_date, active)
    values (client_a, prog_id, v_start, true);

  -- Squat: logged MONDAY, a ramp, weights actually typed.
  insert into public.workout_logs (id, client_id, date, workout_id, completed, completed_at)
    values (gen_random_uuid(), client_a, v_start, w_push, true, now())
    returning id into log_old;
  insert into public.exercise_logs (workout_log_id, exercise_id, exercise_name, mode, sort_order)
    values (log_old, ex_squat, 'Back Squat', 'reps', 0) returning id into el_id;
  insert into public.set_logs (exercise_log_id, set_number, completed, weight, weight_unit, weight_entered)
    values (el_id, 1, true, 135, 'lbs', true),
           (el_id, 2, true, 155, 'lbs', true),
           (el_id, 3, true, 175, 'lbs', true);

  -- An OLDER squat session that must lose to Monday's.
  insert into public.workout_logs (id, client_id, date, workout_id, completed, completed_at)
    values (gen_random_uuid(), client_a, v_start - 7, w_push, true, now())
    returning id into log_mid;
  insert into public.exercise_logs (workout_log_id, exercise_id, exercise_name, mode, sort_order)
    values (log_mid, ex_squat, 'Back Squat', 'reps', 0) returning id into el_id;
  insert into public.set_logs (exercise_log_id, set_number, completed, weight, weight_unit, weight_entered)
    values (el_id, 1, true, 95, 'lbs', true);

  -- Row: logged WEDNESDAY (more recently than the squat) but only checked
  -- off — no weight typed. P2 says this must not seed a progression.
  insert into public.workout_logs (id, client_id, date, workout_id, completed, completed_at)
    values (gen_random_uuid(), client_a, v_start + 2, w_push, true, now())
    returning id into log_mid;
  insert into public.exercise_logs (workout_log_id, exercise_id, exercise_name, mode, sort_order)
    values (log_mid, ex_row, 'Barbell Row', 'reps', 0) returning id into el_id;
  insert into public.set_logs (exercise_log_id, set_number, completed, weight_entered)
    values (el_id, 1, true, false);

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  -- ---------------------------------------------------------------------
  -- 2. last_set_weights
  -- ---------------------------------------------------------------------
  v_day := public.get_workout_day(v_today);
  v_last := v_day->'last_set_weights';

  if v_last is null then
    failures := array_append(failures, 'get_workout_day returned no last_set_weights key');
  end if;

  -- The case previous_log cannot serve: the most recent SESSION (Wednesday)
  -- contains no squat at all, yet the squat target must still resolve.
  if (v_last->ex_squat::text->'1'->>'weight')::numeric is distinct from 135 then
    failures := array_append(failures,
      format('squat set 1 should resolve to Monday''s 135, got %s',
             v_last->ex_squat::text->'1'->>'weight'));
  end if;
  -- Per set NUMBER, so a ramp stays a ramp rather than collapsing to one value.
  if (v_last->ex_squat::text->'2'->>'weight')::numeric is distinct from 155
     or (v_last->ex_squat::text->'3'->>'weight')::numeric is distinct from 175 then
    failures := array_append(failures, 'squat sets 2/3 did not keep their own prior weights');
  end if;
  if v_last->ex_squat::text->'1'->>'weight_unit' is distinct from 'lbs' then
    failures := array_append(failures, 'last weight lost its unit (P6)');
  end if;
  -- The older session must lose to the newer one.
  if (v_last->ex_squat::text->'1'->>'weight')::numeric = 95 then
    failures := array_append(failures, 'squat resolved against the OLDER session');
  end if;
  -- P2: a bare check-off is not a lift.
  if v_last ? ex_row::text then
    failures := array_append(failures,
      'row appeared in last_set_weights despite weight_entered = false (P2)');
  end if;
  -- Never logged at all.
  if v_last ? ex_bench::text then
    failures := array_append(failures, 'bench has no history and must be absent');
  end if;

  -- ---------------------------------------------------------------------
  -- 3. The two writers disagree on purpose
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);

  begin
    v_new_id := public.save_workout(jsonb_build_object(
      'name', 'Bad Prescription',
      'type', 'workout',
      'exercises', jsonb_build_array(jsonb_build_object(
        'mode', 'reps',
        'set_configs', '[{"reps":8,"weight":95}]'::jsonb  -- no unit, violates P6
      ))
    ));
    failures := array_append(failures, 'save_workout accepted a unitless weight');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if sqlerrm <> 'invalid_set_config' then
      failures := array_append(failures,
        format('save_workout raised %s (%s), expected invalid_set_config', sqlerrm, v_sqlstate));
    end if;
  end;

  -- The log side keeps the client's work and drops only the bad snapshot.
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  v_new_id := public.save_workout_log(v_today, w_push, true, jsonb_build_array(
    jsonb_build_object(
      'exercise_id', ex_squat,
      'exercise_name', 'Back Squat',
      'mode', 'reps',
      'sort_order', 0,
      'prescribed', '[{"reps":5,"garbage":true}]'::jsonb,
      'sets', jsonb_build_array(jsonb_build_object(
        'set_number', 1,
        'completed', true,
        'weight', 185,
        'weight_unit', 'lbs',
        'weight_entered', true,
        'prescribed', '{"reps":5,"garbage":true}'::jsonb
      ))
    )
  ));

  if v_new_id is null then
    failures := array_append(failures,
      'save_workout_log rejected a log because its prescription snapshot was malformed');
  end if;

  select count(*) into v_count
  from public.set_logs sl
  join public.exercise_logs el on el.id = sl.exercise_log_id
  where el.workout_log_id = v_new_id and sl.weight = 185 and sl.prescribed is null;
  if v_count <> 1 then
    failures := array_append(failures,
      'the client''s logged weight should survive with a null prescribed snapshot');
  end if;

  raise exception 'PROGRESSIVE_TARGET_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
