-- Assertions for the Phase 4 read RPCs (migration 0021).
--
-- Covers the payload shape each hook destructures, and B6: a past date must
-- resolve against the assignment that was in force ON that date, not against
-- whatever is active now.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0021_read_rpc_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id uuid := 'ab000000-0000-0000-0000-000000000001';
  client_a uuid := 'ab000000-0000-0000-0000-00000000000a';

  w_old   uuid := 'bc000000-0000-0000-0000-000000000001';
  w_new   uuid := 'bc000000-0000-0000-0000-000000000002';
  w_warm  uuid := 'bc000000-0000-0000-0000-000000000003';
  ex_id   uuid := 'ec000000-0000-0000-0000-000000000001';
  prog_old uuid := 'cd000000-0000-0000-0000-000000000001';
  prog_new uuid := 'cd000000-0000-0000-0000-000000000002';

  -- Two Mondays: the old program covered the first, the new one starts later.
  v_old_start date := (date_trunc('week', current_date) - interval '4 weeks')::date;
  v_new_start date := date_trunc('week', current_date)::date;

  v_day jsonb;
  v_week jsonb;
  v_keys text;
  v_count int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (coach_id, 'read-coach@test.local', jsonb_build_object('role','coach','display_name','Read Coach')),
    (client_a, 'read-client@test.local',
      jsonb_build_object('role','client','display_name','Read Client','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_id, 'Bench', coach_id);
  insert into public.workouts (id, name, type, created_by) values (w_warm, 'Warm', 'warmup', coach_id);
  insert into public.workouts (id, name, type, warmup_id, created_by)
    values (w_old, 'Old Push', 'workout', w_warm, coach_id);
  insert into public.workouts (id, name, type, created_by) values (w_new, 'New Push', 'workout', coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
    values (w_old, ex_id, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
    values (w_warm, ex_id, 0, 'reps', '[{"reps":10}]'::jsonb);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
    values (w_new, ex_id, 0, 'reps', '[{"reps":3,"weight":225,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (prog_old, 'Old Program', 8, coach_id);
  insert into public.programs (id, name, weeks, created_by) values (prog_new, 'New Program', 8, coach_id);
  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id)
    values (prog_old, 1, 'monday', w_old);
  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id)
    values (prog_new, 1, 'monday', w_new);

  insert into public.assignments (client_id, program_id, start_date, active)
    values (client_a, prog_old, v_old_start, false);
  insert into public.assignments (client_id, program_id, start_date, active)
    values (client_a, prog_new, v_new_start, true);

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  -- ---------------------------------------------------------------------
  -- Payload shape: every key the hooks destructure must be present
  -- ---------------------------------------------------------------------
  v_day := public.get_workout_day(v_new_start);

  select string_agg(k, ',' order by k) into v_keys from jsonb_object_keys(v_day) k;
  if v_keys is distinct from
     'exercises,in_range,log,previous_log,program_end_date,program_start_date,warmup,warmup_exercises,workout' then
    failures := array_append(failures, format('get_workout_day payload keys changed: %s', v_keys));
  end if;

  if v_day->'workout'->>'name' is distinct from 'New Push' then
    failures := array_append(failures,
      format('expected today to resolve to New Push, got %s', v_day->'workout'->>'name'));
  end if;

  if (v_day->>'in_range')::boolean is not true then
    failures := array_append(failures, 'today should be in range of the active program');
  end if;

  -- The joined exercise name the logger renders must come through.
  if v_day->'exercises'->0->'exercises'->>'name' is distinct from 'Bench' then
    failures := array_append(failures, 'exercises[].exercises.name missing — the logger has no display name');
  end if;

  -- ---------------------------------------------------------------------
  -- B6: a PAST date resolves against the assignment in force then
  -- ---------------------------------------------------------------------
  v_day := public.get_workout_day(v_old_start);
  if v_day->'workout'->>'name' is distinct from 'Old Push' then
    failures := array_append(failures,
      format('a past date must resolve against the assignment in force then (B6): got %s',
        coalesce(v_day->'workout'->>'name', 'null')));
  end if;

  -- Its warmup travels with it.
  if v_day->'warmup'->>'name' is distinct from 'Warm' then
    failures := array_append(failures,
      format('expected the old workout''s warmup, got %s', coalesce(v_day->'warmup'->>'name','null')));
  end if;
  if jsonb_array_length(v_day->'warmup_exercises') <> 1 then
    failures := array_append(failures, 'warmup exercises did not come through');
  end if;

  -- ---------------------------------------------------------------------
  -- get_workout_week
  -- ---------------------------------------------------------------------
  v_week := public.get_workout_week(v_new_start, 7);
  if jsonb_array_length(v_week) <> 7 then
    failures := array_append(failures, format('expected 7 week rows, got %s', jsonb_array_length(v_week)));
  end if;
  if v_week->0->>'workout_id' is null then
    failures := array_append(failures, 'the Monday of the active week should resolve to a workout');
  end if;
  if v_week->0->>'date' is distinct from v_new_start::text then
    failures := array_append(failures, 'week rows are not ordered from the start date');
  end if;

  -- The week grid and the day view must never disagree.
  select count(*) into v_count
  from jsonb_array_elements(v_week) r
  where coalesce(r->>'workout_id','-')
        is distinct from coalesce(public.get_workout_day((r->>'date')::date)->'workout'->>'id','-');
  if v_count <> 0 then
    failures := array_append(failures,
      format('%s day(s) where the week grid disagrees with the day view', v_count));
  end if;

  raise exception 'READ_RPC_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
