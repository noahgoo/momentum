-- Assertions for migration 0042 (save_client_program).
--
-- Same shape as 0019_write_rpc_assertions.sql: one transaction, one DO block,
-- failures collected and always raised at the end so everything rolls back.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0042_client_program_editing_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id    uuid := 'a4200000-0000-0000-0000-000000000001';
  other_coach uuid := 'a4200000-0000-0000-0000-000000000002';
  client_a    uuid := 'a4200000-0000-0000-0000-00000000000a';
  ex_squat    uuid := 'e4200000-0000-0000-0000-000000000001';
  w_legs      uuid := 'b4200000-0000-0000-0000-000000000001';
  w_push      uuid := 'b4200000-0000-0000-0000-000000000002';
  w_foreign   uuid := 'b4200000-0000-0000-0000-000000000003';
  template_id uuid := 'c4200000-0000-0000-0000-000000000001';

  v_start date := date_trunc('week', current_date)::date - 7;  -- a Monday, last week
  v_copy uuid;
  v_phase1 uuid;
  v_mon uuid;
  v_wed uuid;
  v_log uuid;
  v_row record;
  v_count int;
  v_updated timestamptz;

begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (coach_id, 'cp-coach@test.local', jsonb_build_object('role','coach','display_name','CP Coach')),
    (other_coach, 'cp-other@test.local', jsonb_build_object('role','coach','display_name','Other Coach')),
    (client_a, 'cp-client@test.local',
      jsonb_build_object('role','client','display_name','CP Client','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_squat, 'Squat', coach_id);
  insert into public.workouts (id, name, created_by) values
    (w_legs, 'Legs', coach_id), (w_push, 'Push', coach_id), (w_foreign, 'Theirs', other_coach);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_legs, ex_squat, 0, 'reps', '[{"reps":5}]'::jsonb),
         (w_push, ex_squat, 0, 'reps', '[{"reps":8}]'::jsonb);

  -- A phased template, assigned: the client gets their own copy.
  insert into public.programs (id, name, weeks, created_by) values (template_id, 'Base', 2, coach_id);
  insert into public.program_phases (id, program_id, name, sort_order, weeks)
  values ('d4200000-0000-0000-0000-000000000001', template_id, 'P1', 0, 2);
  perform public.materialize_session(null, 'd4200000-0000-0000-0000-000000000001', 1, 'monday', w_legs);
  perform public.materialize_session(null, 'd4200000-0000-0000-0000-000000000001', 1, 'wednesday', w_push);

  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);
  perform public.assign_program(client_a, template_id, v_start);
  select a.program_id into v_copy from public.assignments a where a.client_id = client_a and a.active;
  select id into v_phase1 from public.program_phases where program_id = v_copy;
  select id into v_mon from public.sessions where phase_id = v_phase1 and day_of_week = 'monday';
  select id into v_wed from public.sessions where phase_id = v_phase1 and day_of_week = 'wednesday';

  -- The coach edits Monday's day, and the client logs it.
  update public.session_exercises set set_configs = '[{"reps":3}]'::jsonb where session_id = v_mon;
  insert into public.workout_logs (client_id, date, session_id, session_name, completed)
  values (client_a, v_start, v_mon, 'Legs', true) returning id into v_log;

  -- 1. Swap Monday and Wednesday: both days keep their ids and contents.
  perform public.save_client_program(v_copy, jsonb_build_object(
    'name', 'Base (Alex)', 'phased', true,
    'phases', jsonb_build_array(jsonb_build_object('id', v_phase1, 'name', 'P1', 'weeks', 2)),
    'slots', jsonb_build_array(
      jsonb_build_object('phase_index', 0, 'week_number', 1, 'day_of_week', 'wednesday', 'session_id', v_mon),
      jsonb_build_object('phase_index', 0, 'week_number', 1, 'day_of_week', 'monday', 'session_id', v_wed))));

  select day_of_week into v_row from public.sessions where id = v_mon;
  if v_row.day_of_week is distinct from 'wednesday' then
    failures := array_append(failures, 'a swapped day should keep its id and move');
  end if;
  if (select set_configs from public.session_exercises where session_id = v_mon) <> '[{"reps":3}]'::jsonb then
    failures := array_append(failures, 'a moved day should keep its edited exercises');
  end if;
  if (select name from public.programs where id = v_copy) <> 'Base (Alex)' then
    failures := array_append(failures, 'the client program should be renamed');
  end if;

  -- The template is untouched by any of this (R1).
  if (select count(*) from public.sessions s join public.program_phases ph on ph.id = s.phase_id
      where ph.program_id = template_id and s.day_of_week = 'monday' and s.source_workout_id = w_legs) <> 1 then
    failures := array_append(failures, 'editing the client copy must not change the template');
  end if;

  -- 2. Add a second phase, a library day, and a blank day; drop the moved
  --    Monday (which has a log).
  perform public.save_client_program(v_copy, jsonb_build_object(
    'name', 'Base (Alex)', 'phased', true,
    'phases', jsonb_build_array(
      jsonb_build_object('id', v_phase1, 'name', 'P1', 'weeks', 2),
      jsonb_build_object('name', 'P2', 'weeks', 1)),
    'slots', jsonb_build_array(
      jsonb_build_object('phase_index', 0, 'week_number', 1, 'day_of_week', 'monday', 'session_id', v_wed),
      jsonb_build_object('phase_index', 0, 'week_number', 2, 'day_of_week', 'friday', 'workout_id', w_legs),
      jsonb_build_object('phase_index', 1, 'week_number', 1, 'day_of_week', 'tuesday', 'name', 'Mobility'))));

  if exists (select 1 from public.sessions where id = v_mon) then
    failures := array_append(failures, 'a day left out of the payload should be deleted');
  end if;
  select session_id, session_name into v_row from public.workout_logs where id = v_log;
  if v_row.session_id is not null or v_row.session_name <> 'Legs' then
    failures := array_append(failures, 'deleting a day must keep its log, with its snapshot name');
  end if;
  if (select weeks from public.programs where id = v_copy) <> 3 then
    failures := array_append(failures, 'program weeks should be the sum of phase weeks');
  end if;
  select count(*) into v_count from public.session_exercises se join public.sessions s on s.id = se.session_id
  join public.program_phases ph on ph.id = s.phase_id
  where ph.program_id = v_copy and s.day_of_week = 'friday' and s.source_workout_id = w_legs;
  if v_count <> 1 then
    failures := array_append(failures, 'a library day should be copied in with its exercises');
  end if;
  if public.resolve_scheduled_workout(client_a, v_start + 15) is null then
    failures := array_append(failures, 'the new phase 2 day should resolve on its global date');
  end if;

  -- 3. Switch to flat: the kept day survives under program scope.
  perform public.save_client_program(v_copy, jsonb_build_object(
    'name', 'Base (Alex)', 'phased', false, 'weeks', 4,
    'slots', jsonb_build_array(
      jsonb_build_object('week_number', 4, 'day_of_week', 'sunday', 'session_id', v_wed))));
  select program_id, phase_id, week_number into v_row from public.sessions where id = v_wed;
  if v_row.program_id is distinct from v_copy or v_row.phase_id is not null or v_row.week_number <> 4 then
    failures := array_append(failures, 'switching to flat should move kept days to program scope');
  end if;
  if exists (select 1 from public.program_phases where program_id = v_copy) then
    failures := array_append(failures, 'switching to flat should remove the phases');
  end if;

  -- 4. Refusals.
  begin
    perform public.save_client_program(template_id, '{"phased":false,"weeks":1,"slots":[]}'::jsonb);
    failures := array_append(failures, 'a template should be refused');
  exception when others then
    if sqlerrm <> 'not_a_client_program' then
      failures := array_append(failures, 'template refusal raised ' || sqlerrm);
    end if;
  end;

  begin
    perform public.save_client_program(v_copy, jsonb_build_object('phased', false, 'weeks', 4,
      'slots', jsonb_build_array(jsonb_build_object('week_number', 1, 'day_of_week', 'monday', 'workout_id', w_foreign))));
    failures := array_append(failures, 'another coach''s workout should be refused');
  exception when others then
    if sqlerrm <> 'not_found_or_forbidden' then
      failures := array_append(failures, 'foreign workout raised ' || sqlerrm);
    end if;
  end;

  begin
    perform public.save_client_program(v_copy, jsonb_build_object('phased', false, 'weeks', 4,
      'slots', jsonb_build_array(
        jsonb_build_object('week_number', 1, 'day_of_week', 'monday', 'name', 'A'),
        jsonb_build_object('week_number', 1, 'day_of_week', 'monday', 'name', 'B'))));
    failures := array_append(failures, 'two days on one slot should be refused');
  exception when others then
    if sqlerrm <> 'duplicate_slot' then
      failures := array_append(failures, 'duplicate slot raised ' || sqlerrm);
    end if;
  end;

  begin
    perform public.save_client_program(v_copy, jsonb_build_object('phased', false, 'weeks', 2,
      'slots', jsonb_build_array(jsonb_build_object('week_number', 4, 'day_of_week', 'sunday', 'session_id', v_wed))));
    failures := array_append(failures, 'a day past the last week should be refused');
  exception when others then
    if sqlerrm <> 'invalid_payload' then
      failures := array_append(failures, 'out-of-range week raised ' || sqlerrm);
    end if;
  end;

  select updated_at into v_updated from public.programs where id = v_copy;
  begin
    perform public.save_client_program(v_copy, '{"phased":false,"weeks":4,"slots":[]}'::jsonb, v_updated - interval '1 second');
    failures := array_append(failures, 'a stale expected_updated_at should be refused');
  exception when others then
    if sqlerrm <> 'stale_write' then
      failures := array_append(failures, 'stale write raised ' || sqlerrm);
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', other_coach)::text, true);
  begin
    perform public.save_client_program(v_copy, '{"phased":false,"weeks":4,"slots":[]}'::jsonb);
    failures := array_append(failures, 'another coach should not be able to edit this client program');
  exception when others then
    if sqlerrm <> 'not_found_or_forbidden' then
      failures := array_append(failures, 'other coach raised ' || sqlerrm);
    end if;
  end;

  if array_length(failures, 1) is null then
    raise exception 'CLIENT_PROGRAM_EDITING_ASSERTIONS PASSED — %', failures;
  else
    raise exception 'CLIENT_PROGRAM_EDITING_ASSERTIONS FAILED — %', failures;
  end if;
end;
$$;

rollback;
