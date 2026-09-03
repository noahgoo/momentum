-- Assertions for the Phase 1c write RPCs (migration 0019).
--
-- Same shape as wave3_assertions.sql: one outer transaction, one DO block
-- that inserts fixtures, collects failures into a text[], and always raises
-- PASSED/FAILED at the end so the result is readable from the error message
-- and everything rolls back regardless of outcome.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0019_write_rpc_assertions.sql
--
-- The RPCs read auth.uid(), which is null under psql. Each block sets
-- request.jwt.claims to impersonate a fixture user, the same way PostgREST
-- would, so the auth.uid()-derived client_id path is exercised for real.

begin;

do $$
declare
  failures text[] := '{}';

  coach_id   uuid := 'a9000000-0000-0000-0000-000000000001';
  client_a   uuid := 'a9000000-0000-0000-0000-00000000000a';
  client_b   uuid := 'a9000000-0000-0000-0000-00000000000b';

  w_mon      uuid := 'b9000000-0000-0000-0000-000000000001';
  ex_squat   uuid := 'e9000000-0000-0000-0000-000000000001';
  program_id uuid := 'c9000000-0000-0000-0000-000000000001';
  assign_id  uuid := 'f9000000-0000-0000-0000-000000000001';

  -- start_date is a Monday relative to today so the fixture never ages out
  -- (wave3_assertions.sql hardcodes a date and self-documents that fragility).
  v_start date := date_trunc('week', current_date)::date;
  v_scheduled date;
  v_rest date;

  v_log_id uuid;
  v_count int;
  v_bool boolean;
  v_text text;
  v_jsonb jsonb;
  v_result jsonb;
begin
  v_scheduled := v_start;          -- Monday: scheduled
  v_rest      := v_start + 1;      -- Tuesday: nothing scheduled

  -- ---------------------------------------------------------------------
  -- Fixtures
  -- ---------------------------------------------------------------------
  -- invited_by must be in the metadata at insert time: the 0010 signup
  -- trigger creates the profile, which cascades into client_summaries, whose
  -- coach_id is NOT NULL. Setting it in a later UPDATE is too late.
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'rpc-coach@test.local',
      jsonb_build_object('role', 'coach', 'display_name', 'RPC Coach')),
    (client_a, 'rpc-client-a@test.local',
      jsonb_build_object('role', 'client', 'display_name', 'RPC Client A', 'invited_by', coach_id::text)),
    (client_b, 'rpc-client-b@test.local',
      jsonb_build_object('role', 'client', 'display_name', 'RPC Client B', 'invited_by', coach_id::text))
  on conflict (id) do nothing;

  update public.profiles set timezone = 'America/New_York' where id in (client_a, client_b);

  insert into public.exercises (id, name, created_by) values (ex_squat, 'Squat', coach_id);
  insert into public.workouts (id, name, created_by) values (w_mon, 'Monday Lift', coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_mon, ex_squat, 0, 'reps',
    '[{"reps":5,"weight":135,"weight_unit":"lbs"},{"reps":5,"weight":145,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (program_id, 'RPC Program', 4, coach_id);
  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id)
  values (program_id, 1, 'monday', w_mon);
  insert into public.assignments (id, client_id, program_id, start_date, active)
  values (assign_id, client_a, program_id, v_start, true);

  -- Impersonate client A for every RPC call below.
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  -- ---------------------------------------------------------------------
  -- save_workout_log (B7)
  -- ---------------------------------------------------------------------

  v_log_id := public.save_workout_log(
    v_scheduled, w_mon, false,
    '[{"exercise_id":"e9000000-0000-0000-0000-000000000001","exercise_name":"Squat",
       "mode":"reps","sort_order":0,
       "prescribed":[{"reps":5,"weight":135,"weight_unit":"lbs"}],
       "sets":[{"set_number":1,"completed":true,"reps":5,"weight":135,"weight_unit":"lbs",
                "weight_entered":true,"prescribed":{"reps":5,"weight":135,"weight_unit":"lbs"}},
               {"set_number":2,"completed":false,
                "prescribed":{"reps":5,"weight":145,"weight_unit":"lbs"}}]}]'::jsonb);

  if v_log_id is null then
    failures := array_append(failures, 'save_workout_log returned null log id');
  end if;

  select count(*) into v_count from public.exercise_logs where workout_log_id = v_log_id;
  if v_count <> 1 then
    failures := array_append(failures, format('expected 1 exercise_log, got %s', v_count));
  end if;

  select count(*) into v_count
  from public.set_logs sl join public.exercise_logs el on el.id = sl.exercise_log_id
  where el.workout_log_id = v_log_id;
  if v_count <> 2 then
    failures := array_append(failures, format('expected 2 set_logs, got %s', v_count));
  end if;

  -- Called twice, the tree is replaced, not duplicated (idempotent per C4).
  perform public.save_workout_log(
    v_scheduled, w_mon, true,
    '[{"exercise_id":"e9000000-0000-0000-0000-000000000001","exercise_name":"Squat",
       "mode":"reps","sort_order":0,
       "sets":[{"set_number":1,"completed":true,"reps":5,"weight":135,"weight_unit":"lbs","weight_entered":true}]}]'::jsonb);

  select count(*) into v_count
  from public.set_logs sl join public.exercise_logs el on el.id = sl.exercise_log_id
  where el.workout_log_id = v_log_id;
  if v_count <> 1 then
    failures := array_append(failures,
      format('re-saving should replace children, not duplicate: expected 1 set_log, got %s', v_count));
  end if;

  select count(*) into v_count from public.workout_logs where client_id = client_a and date = v_scheduled;
  if v_count <> 1 then
    failures := array_append(failures, format('expected exactly 1 workout_log row, got %s', v_count));
  end if;

  -- P-1: the prescription snapshot is stored on the log.
  select sl.prescribed into v_jsonb
  from public.set_logs sl join public.exercise_logs el on el.id = sl.exercise_log_id
  where el.workout_log_id = v_log_id and sl.set_number = 1;

  -- (second save omitted `prescribed`, so it is null now — assert the FIRST
  -- save stored it by re-saving with it and re-reading)
  perform public.save_workout_log(
    v_scheduled, w_mon, true,
    '[{"exercise_id":"e9000000-0000-0000-0000-000000000001","exercise_name":"Squat",
       "mode":"reps","sort_order":0,
       "sets":[{"set_number":1,"completed":true,"reps":5,"weight":135,"weight_unit":"lbs",
                "weight_entered":true,"prescribed":{"reps":5,"weight":135,"weight_unit":"lbs"}}]}]'::jsonb);

  select sl.prescribed into v_jsonb
  from public.set_logs sl join public.exercise_logs el on el.id = sl.exercise_log_id
  where el.workout_log_id = v_log_id and sl.set_number = 1;
  if v_jsonb is null or (v_jsonb->>'weight')::numeric <> 135 then
    failures := array_append(failures,
      format('set_logs.prescribed should hold the target weight, got %s', coalesce(v_jsonb::text, 'null')));
  end if;

  -- P-1 proper: editing the workout must NOT change what the log says.
  update public.workout_exercises
  set set_configs = '[{"reps":8,"weight":225,"weight_unit":"lbs"}]'::jsonb
  where workout_id = w_mon;

  select sl.prescribed into v_jsonb
  from public.set_logs sl join public.exercise_logs el on el.id = sl.exercise_log_id
  where el.workout_log_id = v_log_id and sl.set_number = 1;
  if (v_jsonb->>'weight')::numeric <> 135 then
    failures := array_append(failures,
      'editing the workout rewrote a past log''s prescription — the snapshot is not doing its job');
  end if;

  -- W2: saving the log must not touch warmup_completed.
  update public.workout_logs set warmup_completed = true where id = v_log_id;
  perform public.save_workout_log(v_scheduled, w_mon, true, '[]'::jsonb);
  select warmup_completed into v_bool from public.workout_logs where id = v_log_id;
  if not v_bool then
    failures := array_append(failures, 'save_workout_log cleared warmup_completed (W2 violation)');
  end if;

  -- Cannot CREATE a log on an unscheduled date.
  begin
    perform public.save_workout_log(v_rest, w_mon, true, '[]'::jsonb);
    failures := array_append(failures, 'save_workout_log should raise not_scheduled for a rest day');
  exception when others then
    if sqlerrm <> 'not_scheduled' then
      failures := array_append(failures, format('expected not_scheduled, got: %s', sqlerrm));
    end if;
  end;

  -- ---------------------------------------------------------------------
  -- set_warmup_completed (W-1)
  -- ---------------------------------------------------------------------

  -- W2 in the other direction: does not clear `completed`.
  perform public.set_warmup_completed(v_scheduled, false);
  select completed into v_bool from public.workout_logs where id = v_log_id;
  if not v_bool then
    failures := array_append(failures, 'set_warmup_completed cleared completed (W2 violation)');
  end if;

  select warmup_completed into v_bool from public.workout_logs where id = v_log_id;
  if v_bool then
    failures := array_append(failures, 'set_warmup_completed(false) did not clear warmup_completed');
  end if;

  -- Must not create a stub log for a rest day (the W-1 bug).
  begin
    perform public.set_warmup_completed(v_rest, true);
    failures := array_append(failures, 'set_warmup_completed should raise not_scheduled for a rest day');
  exception when others then
    if sqlerrm <> 'not_scheduled' then
      failures := array_append(failures, format('expected not_scheduled, got: %s', sqlerrm));
    end if;
  end;

  select count(*) into v_count from public.workout_logs where client_id = client_a and date = v_rest;
  if v_count <> 0 then
    failures := array_append(failures, 'a rest day got a workout_logs stub row');
  end if;

  -- ---------------------------------------------------------------------
  -- send_message (M-1)
  -- ---------------------------------------------------------------------

  v_result := public.send_message(client_a, 'hello from the client');

  if v_result->>'message_id' is null or v_result->>'thread_id' is null then
    failures := array_append(failures, 'send_message did not return message_id/thread_id');
  end if;
  if v_result->>'sent_at' is null then
    failures := array_append(failures, 'send_message must return the server sent_at (M-3)');
  end if;

  -- The thread's denormalized fields moved with the message.
  select last_message, unread_for_coach
  into v_text, v_bool
  from public.threads where client_id = client_a;

  if v_text <> 'hello from the client' then
    failures := array_append(failures, format('thread.last_message not updated, got %s', coalesce(v_text, 'null')));
  end if;
  if not v_bool then
    failures := array_append(failures, 'a client message must set unread_for_coach');
  end if;

  select unread_for_client into v_bool from public.threads where client_id = client_a;
  if v_bool then
    failures := array_append(failures, 'a client message must clear unread_for_client');
  end if;

  -- Coach replying flips the flags the other way.
  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);
  perform public.send_message(client_a, 'reply from the coach');

  select unread_for_client into v_bool
  from public.threads where client_id = client_a;
  if not v_bool then
    failures := array_append(failures, 'a coach message must set unread_for_client');
  end if;
  select unread_for_coach into v_bool from public.threads where client_id = client_a;
  if v_bool then
    failures := array_append(failures, 'a coach message must clear unread_for_coach');
  end if;

  select count(*) into v_count
  from public.messages m join public.threads t on t.id = m.thread_id
  where t.client_id = client_a;
  if v_count <> 2 then
    failures := array_append(failures, format('expected 2 messages, got %s', v_count));
  end if;

  -- A coach cannot write into a thread for someone else's client.
  perform set_config('request.jwt.claims', json_build_object('sub', client_b)::text, true);
  begin
    perform public.send_message(client_a, 'i should not be able to send this');
    failures := array_append(failures, 'a client sending into another client''s thread should raise');
  exception when others then
    if sqlerrm <> 'no_thread_permission' then
      failures := array_append(failures, format('expected no_thread_permission, got: %s', sqlerrm));
    end if;
  end;

  -- Empty messages are rejected.
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  begin
    perform public.send_message(client_a, '   ');
    failures := array_append(failures, 'whitespace-only message should raise empty_message');
  exception when others then
    if sqlerrm <> 'empty_message' then
      failures := array_append(failures, format('expected empty_message, got: %s', sqlerrm));
    end if;
  end;

  -- ---------------------------------------------------------------------
  -- Report
  -- ---------------------------------------------------------------------
  raise exception 'WRITE_RPC_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
