-- Assertions for schedule moves (0041): request_schedule_moves,
-- decide_schedule_moves, cancel_schedule_moves, get_movable_days,
-- apply_schedule_move.
--
-- Dates are built from the client's own today (client_today), never from
-- current_date, so the suite means the same thing on any day of the week. The
-- program starts on the Monday three weeks before the client's this-week
-- Monday: weeks 1-3 are behind them (missed days), week 4 holds today, weeks
-- 5-8 are ahead. Sessions sit on Monday and Wednesday of every week; Tuesday
-- and Friday are rest days.
--
-- Same rollback-safe shape as the other suites.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0041_schedule_moves_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  v_coach uuid := 'd1000000-0000-0000-0000-000000000001';
  client_a uuid := 'd1000000-0000-0000-0000-00000000000a';

  prog    uuid := 'd2000000-0000-0000-0000-000000000001';
  ph      uuid := 'd3000000-0000-0000-0000-000000000001';
  w_push  uuid := 'd4000000-0000-0000-0000-000000000001';
  ex_row  uuid := 'd5000000-0000-0000-0000-000000000001';

  v_today date;
  v_start date;
  v_tue date;
  v_fri date;
  v_batch uuid := 'd6000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_caught text;
  v_ids uuid[];
  v_session uuid;
  v_n int;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_coach, 'moves-coach@test.local',
      jsonb_build_object('role','coach','display_name','Moves Coach')),
    (client_a, 'moves-a@test.local',
      jsonb_build_object('role','client','display_name','Moves A','invited_by',v_coach::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_row, 'Row', v_coach);
  insert into public.workouts (id, name, type, created_by) values (w_push, 'Push Day', 'workout', v_coach);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_push, ex_row, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (prog, 'Moves Program', 8, v_coach);
  insert into public.program_phases (id, program_id, sort_order, weeks) values (ph, prog, 0, 8);
  for v_n in 1..8 loop
    perform public.materialize_session(null, ph, v_n, 'monday', w_push);
    perform public.materialize_session(null, ph, v_n, 'wednesday', w_push);
  end loop;

  v_today := public.client_today(client_a);
  v_start := (date_trunc('week', v_today)::date) - 21;
  v_tue := v_today + ((2 - extract(isodow from v_today)::int + 7) % 7);
  v_fri := v_today + ((5 - extract(isodow from v_today)::int + 7) % 7);

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  perform public.assign_program(client_a, prog, v_start);

  -- ---------------------------------------------------------------------
  -- 1. get_movable_days lists missed days and free rest days
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  v_result := public.get_movable_days();

  if not (v_result->'missed') @> jsonb_build_array(jsonb_build_object('date', v_start)) then
    -- @> on objects matches by containment, so extra keys are fine.
    failures := array_append(failures, '#1 first Monday should be listed as missed');
  end if;
  if not (v_result->'rest_days') @> to_jsonb(v_tue) then
    failures := array_append(failures, format('#1 %s (a rest day) should be offered as a target', v_tue));
  end if;
  if (v_result->'rest_days') @> to_jsonb(v_start) then
    failures := array_append(failures, '#1 a scheduled day must not be offered as a target');
  end if;

  -- ---------------------------------------------------------------------
  -- 2. A batch of two missed days is filed pending and changes nothing yet
  -- ---------------------------------------------------------------------
  v_result := public.request_schedule_moves(v_batch, jsonb_build_array(
    jsonb_build_object('from_date', v_start,     'to_date', v_tue),
    jsonb_build_object('from_date', v_start + 2, 'to_date', v_tue + 2)
  ));
  if (v_result->>'filed')::int is distinct from 2 or (v_result->>'duplicate')::boolean then
    failures := array_append(failures, format('#2 expected 2 filed, got %s', v_result));
  end if;
  if (select count(*) from public.change_requests
      where batch_id = v_batch and status = 'pending' and session_name = 'Push Day') <> 2 then
    failures := array_append(failures, '#2 both lines should be pending with a session_name snapshot');
  end if;
  if public.resolve_scheduled_workout(client_a, v_start) is null then
    failures := array_append(failures, '#2 filing must not move anything before a decision');
  end if;

  -- ---------------------------------------------------------------------
  -- 3. The same batch submitted twice does nothing the second time (C4)
  -- ---------------------------------------------------------------------
  v_result := public.request_schedule_moves(v_batch, jsonb_build_array(
    jsonb_build_object('from_date', v_start, 'to_date', v_tue)
  ));
  if not (v_result->>'duplicate')::boolean
     or (select count(*) from public.change_requests where batch_id = v_batch) <> 2 then
    failures := array_append(failures, '#3 a retried batch must be recognised and write nothing');
  end if;

  -- ---------------------------------------------------------------------
  -- 4. Filing validates server-side; an invalid line lands nothing
  -- ---------------------------------------------------------------------
  -- Target already scheduled.
  v_caught := null;
  begin
    perform public.request_schedule_moves(gen_random_uuid(), jsonb_build_array(
      jsonb_build_object('from_date', v_start + 49, 'to_date', v_start + 51)));
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like 'target_not_rest%' then
    failures := array_append(failures, format('#4 scheduled target: expected target_not_rest, got %s', v_caught));
  end if;

  -- Target in the client's past.
  v_caught := null;
  begin
    perform public.request_schedule_moves(gen_random_uuid(), jsonb_build_array(
      jsonb_build_object('from_date', v_start + 14, 'to_date', v_start + 15)));
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like 'date_passed%' then
    failures := array_append(failures, format('#4 past target: expected date_passed, got %s', v_caught));
  end if;

  -- Source with nothing scheduled.
  v_caught := null;
  begin
    perform public.request_schedule_moves(gen_random_uuid(), jsonb_build_array(
      jsonb_build_object('from_date', v_start + 1, 'to_date', v_tue + 4)));
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like 'nothing_to_move%' then
    failures := array_append(failures, format('#4 rest source: expected nothing_to_move, got %s', v_caught));
  end if;

  -- Source day already pending in another batch.
  v_caught := null;
  begin
    perform public.request_schedule_moves(gen_random_uuid(), jsonb_build_array(
      jsonb_build_object('from_date', v_start, 'to_date', v_fri)));
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like 'already_pending%' then
    failures := array_append(failures, format('#4 re-filing a pending day: expected already_pending, got %s', v_caught));
  end if;

  -- One bad line must not leave its good neighbour behind (R2).
  v_caught := null;
  begin
    perform public.request_schedule_moves(gen_random_uuid(), jsonb_build_array(
      jsonb_build_object('from_date', v_start + 7, 'to_date', v_fri),
      jsonb_build_object('from_date', v_start + 49, 'to_date', v_start + 51)));
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null
     or exists (select 1 from public.change_requests where from_date = v_start + 7 and client_id = client_a) then
    failures := array_append(failures, '#4 a failed batch must land nothing');
  end if;

  -- A day with a log is history and cannot be moved (Event tier).
  insert into public.workout_logs (client_id, date, completed) values (client_a, v_start + 7, true);
  v_caught := null;
  begin
    perform public.request_schedule_moves(gen_random_uuid(), jsonb_build_array(
      jsonb_build_object('from_date', v_start + 7, 'to_date', v_fri)));
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like 'already_logged%' then
    failures := array_append(failures, format('#4 logged source: expected already_logged, got %s', v_caught));
  end if;
  if (public.get_movable_days()->'missed') @> jsonb_build_array(jsonb_build_object('date', v_start + 7)) then
    failures := array_append(failures, '#4 a logged day must not be offered as movable');
  end if;

  -- ---------------------------------------------------------------------
  -- 5. A client cannot write the table directly, nor grant themselves auto
  -- ---------------------------------------------------------------------
  v_caught := null;
  begin
    set local role authenticated;
    insert into public.change_requests (client_id, coach_id, from_date, to_date)
    values (client_a, v_coach, v_start + 21, v_fri);
  exception when others then v_caught := sqlerrm;
  end;
  reset role;
  if v_caught is null then
    failures := array_append(failures, '#5 a direct insert into change_requests should be refused');
  end if;

  v_caught := null;
  begin
    update public.profiles set move_approval = 'auto' where id = client_a;
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null then
    failures := array_append(failures, '#5 a client must not be able to set their own move_approval');
  end if;

  -- ---------------------------------------------------------------------
  -- 6. Coach accepts the whole batch; the sources become rest, the targets
  -- hold the session, and the accepted rows remain as the record
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  select array_agg(id order by position) into v_ids from public.change_requests where batch_id = v_batch;
  v_session := public.resolve_scheduled_workout(client_a, v_start);

  v_result := public.decide_schedule_moves(v_ids, 'accept');
  if (v_result->>'applied')::int is distinct from 2 or jsonb_array_length(v_result->'skipped') <> 0 then
    failures := array_append(failures, format('#6 expected 2 applied, got %s', v_result));
  end if;
  if public.resolve_scheduled_workout(client_a, v_tue) is distinct from v_session then
    failures := array_append(failures, '#6 target should hold the moved session');
  end if;
  if public.resolve_scheduled_workout(client_a, v_start) is not null then
    failures := array_append(failures, '#6 source should now be rest');
  end if;
  if (select count(*) from public.change_requests
      where batch_id = v_batch and status = 'accepted' and decided_by = v_coach and not auto_applied) <> 2 then
    failures := array_append(failures, '#6 accepted rows should record the coach and not auto_applied');
  end if;
  if exists (select 1 from public.workout_logs where client_id = client_a and date = v_start) then
    failures := array_append(failures, '#6 a move must never create or touch a log');
  end if;

  -- Deciding again reports each line instead of double-applying (C5).
  v_result := public.decide_schedule_moves(v_ids, 'accept');
  if (v_result->>'applied')::int <> 0 or jsonb_array_length(v_result->'skipped') <> 2 then
    failures := array_append(failures, format('#6 second decision should skip both, got %s', v_result));
  end if;

  -- ---------------------------------------------------------------------
  -- 7. Partial decision: reject one line, leave the other pending
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  perform public.request_schedule_moves('d6000000-0000-0000-0000-000000000002', jsonb_build_array(
    jsonb_build_object('from_date', v_start + 28, 'to_date', v_tue + 7),
    jsonb_build_object('from_date', v_start + 30, 'to_date', v_fri + 7)
  ));
  select array_agg(id order by position) into v_ids
  from public.change_requests where batch_id = 'd6000000-0000-0000-0000-000000000002';

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  v_result := public.decide_schedule_moves(array[v_ids[1]], 'reject');
  if (v_result->>'rejected')::int is distinct from 1
     or (select status::text from public.change_requests where id = v_ids[1]) <> 'rejected'
     or (select status::text from public.change_requests where id = v_ids[2]) <> 'pending' then
    failures := array_append(failures, format('#7 single-line reject should leave its sibling pending, got %s', v_result));
  end if;
  if public.resolve_scheduled_workout(client_a, v_start + 28) is null then
    failures := array_append(failures, '#7 a rejected move must not change the schedule');
  end if;

  -- ---------------------------------------------------------------------
  -- 8. The client can withdraw a pending line, once (C4)
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  v_n := public.cancel_schedule_moves(array[v_ids[2]]);
  if v_n <> 1 then
    failures := array_append(failures, format('#8 first cancel should withdraw 1 line, got %s', v_n));
  end if;
  v_n := public.cancel_schedule_moves(array[v_ids[2]]);
  if v_n <> 0 then
    failures := array_append(failures, format('#8 second cancel should withdraw 0, got %s', v_n));
  end if;
  if (select status::text from public.change_requests where id = v_ids[2]) <> 'cancelled' then
    failures := array_append(failures, '#8 the withdrawn line should read cancelled');
  end if;

  -- A decided line cannot be withdrawn.
  if public.cancel_schedule_moves((select array_agg(id) from public.change_requests where batch_id = v_batch)) <> 0 then
    failures := array_append(failures, '#8 an accepted move must not be cancellable');
  end if;

  -- ---------------------------------------------------------------------
  -- 9. A move that went stale before the coach acted is skipped, not forced
  -- ---------------------------------------------------------------------
  perform public.request_schedule_moves('d6000000-0000-0000-0000-000000000003', jsonb_build_array(
    jsonb_build_object('from_date', v_start + 35, 'to_date', v_fri + 14)));
  -- The client trains on the source day before the coach looks.
  insert into public.workout_logs (client_id, date, completed) values (client_a, v_start + 35, true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  v_result := public.decide_schedule_moves(
    (select array_agg(id) from public.change_requests where batch_id = 'd6000000-0000-0000-0000-000000000003'),
    'accept');
  if (v_result->>'applied')::int <> 0
     or v_result->'skipped'->0->>'reason' is distinct from 'already_logged'
     or (select skip_reason from public.change_requests where batch_id = 'd6000000-0000-0000-0000-000000000003') is distinct from 'already_logged' then
    failures := array_append(failures, format('#9 a source logged after filing should be skipped, got %s', v_result));
  end if;

  -- ---------------------------------------------------------------------
  -- 10. Auto-approve: applied at filing, recorded as automatic (C8)
  -- ---------------------------------------------------------------------
  update public.profiles set move_approval = 'auto' where id = client_a;

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  v_session := public.resolve_scheduled_workout(client_a, v_start + 21);
  v_result := public.request_schedule_moves('d6000000-0000-0000-0000-000000000004', jsonb_build_array(
    jsonb_build_object('from_date', v_start + 21, 'to_date', v_fri)));
  if (v_result->>'applied')::int is distinct from 1
     or public.resolve_scheduled_workout(client_a, v_fri) is distinct from v_session
     or public.resolve_scheduled_workout(client_a, v_start + 21) is not null
     or not exists (select 1 from public.change_requests
                    where batch_id = 'd6000000-0000-0000-0000-000000000004'
                      and status = 'accepted' and auto_applied and decided_by = client_a) then
    failures := array_append(failures, format('#10 auto mode should apply at filing and say so, got %s', v_result));
  end if;

  -- ---------------------------------------------------------------------
  -- 11. get_moved_days reports where a moved day went
  -- ---------------------------------------------------------------------
  if not (public.get_moved_days(v_start, 7)) @>
         jsonb_build_array(jsonb_build_object('from_date', v_start, 'to_date', v_tue, 'session_name', 'Push Day')) then
    failures := array_append(failures, '#11 get_moved_days should report the accepted move with its snapshot name');
  end if;

  -- ---------------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise notice 'PASSED: schedule moves';
  else
    raise exception E'FAILED:\n  %', array_to_string(failures, E'\n  ');
  end if;
end;
$$;

rollback;
