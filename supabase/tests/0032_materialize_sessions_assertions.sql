-- Assertions for session materialization (migration 0032).
--
-- The one that matters is #2: two weeks scheduling the same workout must get
-- SEPARATE sessions. That is the entire reason for this restructure — under
-- week_schedules they shared one workouts row, so a coach could not vary week
-- 5 without varying week 3.
--
-- Same rollback-safe shape as the other suites: one transaction, one DO block
-- accumulating failures, always raising PASSED/FAILED at the end.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0032_materialize_sessions_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id uuid := 'b0000000-0000-0000-0000-000000000001';
  client_a uuid := 'b0000000-0000-0000-0000-00000000000a';
  client_b uuid := 'b0000000-0000-0000-0000-00000000000b';

  tmpl_program uuid := 'b1000000-0000-0000-0000-000000000001';
  w_push       uuid := 'b2000000-0000-0000-0000-000000000001';
  w_warm       uuid := 'b2000000-0000-0000-0000-000000000002';
  ex_bench     uuid := 'b3000000-0000-0000-0000-000000000001';
  ex_jumps     uuid := 'b3000000-0000-0000-0000-000000000002';

  v_start date := date_trunc('week', current_date)::date;

  v_workouts_before int;
  v_workouts_after int;
  v_assignment uuid;
  v_prog_a uuid;
  v_prog_b uuid;
  v_count int;
  v_s_week1 uuid;
  v_s_week2 uuid;
  v_text text;
begin
  -- -----------------------------------------------------------------------
  -- Fixtures: one template, ONE workout scheduled on TWO different weeks,
  -- with a warm-up linked through warmup_id.
  -- -----------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'mat-coach@test.local',
      jsonb_build_object('role','coach','display_name','Mat Coach')),
    (client_a, 'mat-a@test.local',
      jsonb_build_object('role','client','display_name','Mat A','invited_by',coach_id::text)),
    (client_b, 'mat-b@test.local',
      jsonb_build_object('role','client','display_name','Mat B','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values
    (ex_bench, 'Bench', coach_id),
    (ex_jumps, 'Jumping Jacks', coach_id);

  insert into public.workouts (id, name, type, created_by)
  values (w_warm, 'Warmup A', 'warmup', coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_warm, ex_jumps, 0, 'reps', '[{"reps":20}]'::jsonb);

  insert into public.workouts (id, name, type, warmup_id, created_by)
  values (w_push, 'Push Day', 'workout', w_warm, coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_push, ex_bench, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by)
  values (tmpl_program, 'Mat Template', 2, coach_id);

  -- The same workout on two weeks. Under week_schedules these were two
  -- pointers at one shared workouts row, which is the thing this suite exists
  -- to prove is gone.
  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);
  perform public.materialize_session(tmpl_program, null, 1, 'monday', w_push);
  perform public.materialize_session(tmpl_program, null, 2, 'monday', w_push);

  -- -----------------------------------------------------------------------
  -- 1. One session per scheduled day
  -- -----------------------------------------------------------------------
  select count(*) into v_count from public.sessions where program_id = tmpl_program;
  if v_count <> 2 then
    failures := array_append(failures,
      format('expected 2 sessions for 2 scheduled days, got %s', v_count));
  end if;

  -- -----------------------------------------------------------------------
  -- 2. THE POINT: the two weeks got separate sessions, so editing one cannot
  --    reach the other. Under week_schedules they shared a workouts row.
  -- -----------------------------------------------------------------------
  select id into v_s_week1 from public.sessions
  where program_id = tmpl_program and week_number = 1;
  select id into v_s_week2 from public.sessions
  where program_id = tmpl_program and week_number = 2;

  if v_s_week1 = v_s_week2 or v_s_week1 is null or v_s_week2 is null then
    failures := array_append(failures, 'the two weeks did not get separate sessions');
  end if;

  update public.session_exercises
  set set_configs = '[{"reps":3,"weight":225,"weight_unit":"lbs"}]'::jsonb
  where session_id = v_s_week1 and section = 'main';

  select set_configs->0->>'weight' into v_text
  from public.session_exercises
  where session_id = v_s_week2 and section = 'main';

  if v_text is distinct from '135' then
    failures := array_append(failures,
      format('editing week 1 changed week 2: week 2 now reads weight %s', v_text));
  end if;

  -- The source workout is untouched too — a session is a copy, not a pointer.
  select set_configs->0->>'weight' into v_text
  from public.workout_exercises where workout_id = w_push;
  if v_text is distinct from '135' then
    failures := array_append(failures,
      format('editing a session changed the library workout: now %s', v_text));
  end if;

  -- -----------------------------------------------------------------------
  -- 3. The warm-up was flattened in, not left behind a self-FK
  -- -----------------------------------------------------------------------
  select count(*) into v_count
  from public.session_exercises
  where session_id = v_s_week2 and section = 'warmup';
  if v_count <> 1 then
    failures := array_append(failures,
      format('expected 1 warmup exercise on the session, got %s', v_count));
  end if;

  select warmup_name into v_text from public.sessions where id = v_s_week2;
  if v_text is distinct from 'Warmup A' then
    failures := array_append(failures,
      format('warmup_name was not snapshotted: %L', v_text));
  end if;

  -- -----------------------------------------------------------------------
  -- 4. Display fields are snapshots, not live joins (R8)
  -- -----------------------------------------------------------------------
  update public.workouts set name = 'Renamed In Library' where id = w_push;

  select name into v_text from public.sessions where id = v_s_week2;
  if v_text is distinct from 'Push Day' then
    failures := array_append(failures,
      format('renaming the library workout renamed a scheduled day: %L', v_text));
  end if;

  -- -----------------------------------------------------------------------
  -- 5. Assigning materializes the copy's sessions, per client
  -- -----------------------------------------------------------------------
  select count(*) into v_workouts_before from public.workouts;

  v_assignment := public.assign_program(client_a, tmpl_program, v_start);
  select program_id into v_prog_a from public.assignments where id = v_assignment;
  v_assignment := public.assign_program(client_b, tmpl_program, v_start);
  select program_id into v_prog_b from public.assignments where id = v_assignment;

  select count(*) into v_count from public.sessions where program_id = v_prog_a;
  if v_count <> 2 then
    failures := array_append(failures,
      format('client A got %s sessions, expected 2', v_count));
  end if;

  if exists (
    select 1 from public.sessions a
    join public.sessions b on b.id = a.id
    where a.program_id = v_prog_a and b.program_id = v_prog_b
  ) then
    failures := array_append(failures, 'the two clients share session rows');
  end if;

  -- Editing client A's week 1 reaches neither client B nor A's own week 2.
  select id into v_s_week1 from public.sessions
  where program_id = v_prog_a and week_number = 1;

  update public.session_exercises
  set set_configs = '[{"reps":1,"weight":315,"weight_unit":"lbs"}]'::jsonb
  where session_id = v_s_week1 and section = 'main';

  -- 225, not 135: assertion 2 edited the template's week-1 session, and an
  -- assign copies what the session SAYS. That edit reaching both new clients
  -- is correct — a coach's change to a template day should apply to whoever
  -- they assign it to next, and to nobody already assigned.
  select set_configs->0->>'weight' into v_text
  from public.session_exercises se
  join public.sessions s on s.id = se.session_id
  where s.program_id = v_prog_b and s.week_number = 1 and se.section = 'main';
  if v_text is distinct from '225' then
    failures := array_append(failures,
      format('editing client A''s session changed client B''s: %s', v_text));
  end if;

  select set_configs->0->>'weight' into v_text
  from public.session_exercises se
  join public.sessions s on s.id = se.session_id
  where s.program_id = v_prog_a and s.week_number = 2 and se.section = 'main';
  if v_text is distinct from '135' then
    failures := array_append(failures,
      format('editing client A''s week 1 changed their week 2: %s', v_text));
  end if;

  -- -----------------------------------------------------------------------
  -- 6. An assign writes NO workouts rows
  --
  -- The claim the whole split rests on: sessions are the per-client copy, so
  -- isolating a client no longer means duplicating the coach's library.
  -- -----------------------------------------------------------------------
  select count(*) into v_workouts_after from public.workouts;
  if v_workouts_after <> v_workouts_before then
    failures := array_append(failures, format(
      'two assigns created %s workouts rows; an assign must not touch the library',
      v_workouts_after - v_workouts_before
    ));
  end if;

  -- -----------------------------------------------------------------------
  -- 7. save_program keeps sessions current
  --
  -- Without the resync in save_program, a program edited between now and the
  -- read cutover would keep stale sessions and the edit would silently not
  -- appear once reads switch.
  -- -----------------------------------------------------------------------
  perform public.save_program(
    jsonb_build_object(
      'name', 'Mat Template', 'description', null, 'weeks', 2,
      'phased', false, 'phases', '[]'::jsonb,
      'slots', jsonb_build_array(
        jsonb_build_object('week_number', 1, 'day_of_week', 'monday', 'workout_id', w_push)
      )
    ),
    tmpl_program,
    null
  );

  select count(*) into v_count from public.sessions where program_id = tmpl_program;
  if v_count <> 1 then
    failures := array_append(failures,
      format('save_program left %s sessions after dropping a slot, expected 1', v_count));
  end if;

  -- -----------------------------------------------------------------------
  -- 8. Materializing writes no workouts rows
  -- -----------------------------------------------------------------------
  select count(*) into v_workouts_before from public.workouts;
  perform public.materialize_session(tmpl_program, null, 1, 'monday', w_push);
  select count(*) into v_workouts_after from public.workouts;
  if v_workouts_after <> v_workouts_before then
    failures := array_append(failures, format(
      'materializing created %s workouts rows; sessions must never write the library',
      v_workouts_after - v_workouts_before
    ));
  end if;

  -- -----------------------------------------------------------------------
  -- 9. Re-saving a program preserves per-day edits
  --
  -- The single most likely regression in this restructure. The transitional
  -- resync rebuilt every session on every save, so a coach who edited week 3
  -- and then reopened the program builder and pressed Save lost that edit
  -- with no error. materialize_session leaves a slot alone when its source
  -- workout has not changed.
  -- -----------------------------------------------------------------------
  -- Assertion 7 saved a payload without week 2, which deleted that session.
  -- Re-establish it, then edit it.
  perform public.materialize_session(tmpl_program, null, 2, 'monday', w_push);
  select id into v_s_week2 from public.sessions
  where program_id = tmpl_program and week_number = 2;

  update public.session_exercises
  set set_configs = '[{"reps":1,"weight":405,"weight_unit":"lbs"}]'::jsonb
  where session_id = v_s_week2 and section = 'main';

  perform public.save_program(
    jsonb_build_object(
      'name', 'Mat Template', 'description', null, 'weeks', 2,
      'phased', false, 'phases', '[]'::jsonb,
      'slots', jsonb_build_array(
        jsonb_build_object('week_number', 1, 'day_of_week', 'monday', 'workout_id', w_push),
        jsonb_build_object('week_number', 2, 'day_of_week', 'monday', 'workout_id', w_push)
      )
    ),
    tmpl_program,
    null
  );

  select set_configs->0->>'weight' into v_text
  from public.session_exercises
  where session_id = v_s_week2 and section = 'main';
  if v_text is distinct from '405' then
    failures := array_append(failures, format(
      're-saving the program discarded a per-day edit: week 2 reads %s, not 405',
      coalesce(v_text, 'null')));
  end if;

  if not exists (select 1 from public.sessions where id = v_s_week2) then
    failures := array_append(failures, 're-saving the program replaced the session row itself');
  end if;

  -- But changing which workout a slot uses DOES rebuild it.
  perform public.save_program(
    jsonb_build_object(
      'name', 'Mat Template', 'description', null, 'weeks', 2,
      'phased', false, 'phases', '[]'::jsonb,
      'slots', jsonb_build_array(
        jsonb_build_object('week_number', 2, 'day_of_week', 'monday', 'workout_id', w_warm)
      )
    ),
    tmpl_program,
    null
  );

  select source_workout_id into v_s_week1 from public.sessions
  where program_id = tmpl_program and week_number = 2;
  if v_s_week1 is distinct from w_warm then
    failures := array_append(failures, 'changing a slot''s workout did not rebuild its session');
  end if;

  -- -----------------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise notice 'PASSED: session materialization';
  else
    raise exception E'FAILED:\n  %', array_to_string(failures, E'\n  ');
  end if;
end;
$$;

rollback;
