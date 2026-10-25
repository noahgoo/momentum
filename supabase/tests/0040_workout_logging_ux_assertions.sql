-- Assertions for migration 0040 (load type, distance units, unit prefs).
--
-- Same shape as 0019_write_rpc_assertions.sql: one transaction, one DO block,
-- failures collected and always raised at the end so everything rolls back.
-- The is_valid_set_config truth table for the new keys lives in
-- 0027_progressive_targets_assertions.sql.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0040_workout_logging_ux_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id   uuid := 'a4000000-0000-0000-0000-000000000001';
  client_a   uuid := 'a4000000-0000-0000-0000-00000000000a';
  w_mon      uuid := 'b4000000-0000-0000-0000-000000000001';
  ex_run     uuid := 'e4000000-0000-0000-0000-000000000001';
  program_id uuid := 'c4000000-0000-0000-0000-000000000001';
  assign_id  uuid := 'f4000000-0000-0000-0000-000000000001';

  v_start date := date_trunc('week', current_date)::date;
  v_log_id uuid;
  v_row record;
  v_sqlstate text;
  v_profile record;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (coach_id, 'ux-coach@test.local', jsonb_build_object('role','coach','display_name','UX Coach')),
    (client_a, 'ux-client@test.local',
      jsonb_build_object('role','client','display_name','UX Client','invited_by',coach_id::text))
  on conflict (id) do nothing;

  update public.profiles set timezone = 'America/New_York' where id = client_a;

  -- Profile unit prefs default to lbs / mi.
  select weight_unit, distance_unit into v_profile from public.profiles where id = client_a;
  if v_profile.weight_unit is distinct from 'lbs' or v_profile.distance_unit is distinct from 'mi' then
    failures := array_append(failures, 'profiles should default to lbs / mi');
  end if;

  insert into public.exercises (id, name, created_by) values (ex_run, 'Run', coach_id);
  insert into public.workouts (id, name, created_by) values (w_mon, 'Monday Run', coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_mon, ex_run, 0, 'distance',
    '[{"distance":5,"distance_unit":"km","pace_seconds":330}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (program_id, 'UX Program', 4, coach_id);
  perform public.materialize_session(program_id, null, 1, 'monday', w_mon);
  insert into public.assignments (id, client_id, program_id, start_date, active)
  values (assign_id, client_a, program_id, v_start, true);

  -- A legacy `miles` key is refused at write time, not silently dropped.
  begin
    insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
    values (w_mon, ex_run, 1, 'distance', '[{"miles":2}]'::jsonb);
    failures := array_append(failures, 'set_configs with the old miles key should be rejected');
  exception when check_violation then
    null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  v_log_id := public.save_workout_log(
    v_start, public.resolve_scheduled_workout(client_a, v_start), true,
    '[{"exercise_id":"e4000000-0000-0000-0000-000000000001","exercise_name":"Run",
       "mode":"distance","sort_order":0,
       "sets":[{"set_number":1,"completed":true,"actual_distance":5.2,"distance_unit":"km",
                "actual_seconds":1560,
                "prescribed":{"distance":5,"distance_unit":"km","pace_seconds":330}}]}]'::jsonb);

  select sl.actual_distance, sl.distance_unit, sl.prescribed into v_row
  from public.set_logs sl join public.exercise_logs el on el.id = sl.exercise_log_id
  where el.workout_log_id = v_log_id and sl.set_number = 1;

  if v_row.actual_distance is distinct from 5.2 or v_row.distance_unit is distinct from 'km' then
    failures := array_append(failures,
      format('distance should round-trip with its unit, got %s %s', v_row.actual_distance, v_row.distance_unit));
  end if;
  if v_row.prescribed->>'distance_unit' is distinct from 'km' then
    failures := array_append(failures, 'the prescription snapshot should carry distance_unit (P1/P6)');
  end if;

  -- A distance with no unit cannot be stored (P6).
  begin
    perform public.save_workout_log(
      v_start, public.resolve_scheduled_workout(client_a, v_start), true,
      '[{"exercise_name":"Run","mode":"distance","sort_order":0,
         "sets":[{"set_number":1,"completed":true,"actual_distance":3}]}]'::jsonb);
    failures := array_append(failures, 'an actual_distance without distance_unit should be rejected');
  exception when check_violation then
    null;
  end;

  if array_length(failures, 1) is null then
    raise exception 'WORKOUT_LOGGING_UX_ASSERTIONS PASSED — %', failures;
  else
    raise exception 'WORKOUT_LOGGING_UX_ASSERTIONS FAILED — %', failures;
  end if;
end;
$$;

rollback;
