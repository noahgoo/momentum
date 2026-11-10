-- Assertions for schedule swaps (0046): request_schedule_swap,
-- apply_schedule_swap (via decide_schedule_moves and auto-approval),
-- cancel_schedule_moves on a pair.
--
-- Dates come from the client's own today, never current_date. The program
-- starts on the Monday of the client's this-week Monday, 8 weeks, with a
-- session on Monday and Wednesday of every week (Push on Monday, Pull on
-- Wednesday), so the next-week Monday and Wednesday are two distinct
-- scheduled days ahead of the client.
--
-- Same rollback-safe shape as the other suites.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0046_schedule_swaps_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  v_coach uuid := 'd7000000-0000-0000-0000-000000000001';
  client_a uuid := 'd7000000-0000-0000-0000-00000000000a';

  prog    uuid := 'd7100000-0000-0000-0000-000000000001';
  ph      uuid := 'd7200000-0000-0000-0000-000000000001';
  w_push  uuid := 'd7300000-0000-0000-0000-000000000001';
  w_pull  uuid := 'd7300000-0000-0000-0000-000000000002';
  ex_row  uuid := 'd7400000-0000-0000-0000-000000000001';

  v_today date;
  v_mon date;
  v_wed date;
  v_mon2 date;
  v_batch uuid;
  v_result jsonb;
  v_caught text;
  v_ids uuid[];
  v_n int;
  v_name_mon text;
  v_name_wed text;
  v_sessions_before int;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_coach, 'swaps-coach@test.local',
      jsonb_build_object('role','coach','display_name','Swaps Coach')),
    (client_a, 'swaps-a@test.local',
      jsonb_build_object('role','client','display_name','Swaps A','invited_by',v_coach::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_row, 'Row', v_coach);
  insert into public.workouts (id, name, type, created_by)
  values (w_push, 'Push Day', 'workout', v_coach), (w_pull, 'Pull Day', 'workout', v_coach);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_push, ex_row, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb),
         (w_pull, ex_row, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (prog, 'Swaps Program', 8, v_coach);
  insert into public.program_phases (id, program_id, sort_order, weeks) values (ph, prog, 0, 8);
  for v_n in 1..8 loop
    perform public.materialize_session(null, ph, v_n, 'monday', w_push);
    perform public.materialize_session(null, ph, v_n, 'wednesday', w_pull);
  end loop;

  v_today := public.client_today(client_a);
  v_mon := (date_trunc('week', v_today)::date) + 7;  -- next week's Monday (Push)
  v_wed := v_mon + 2;                                -- next week's Wednesday (Pull)
  v_mon2 := v_mon + 7;                               -- the Monday after (Push)

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  perform public.assign_program(client_a, prog, date_trunc('week', v_today)::date);

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  -- ---------------------------------------------------------------------
  -- 1. Filing a swap writes two linked pending rows and changes nothing yet
  -- ---------------------------------------------------------------------
  v_batch := gen_random_uuid();
  v_result := public.request_schedule_swap(v_batch, v_mon, v_wed);
  if (v_result->>'filed')::int is distinct from 2 or (v_result->>'duplicate')::boolean then
    failures := array_append(failures, format('#1 expected 2 filed, got %s', v_result));
  end if;
  if (select count(distinct swap_id) from public.change_requests
      where batch_id = v_batch and status = 'pending' and swap_id is not null) <> 1
     or (select count(*) from public.change_requests where batch_id = v_batch) <> 2 then
    failures := array_append(failures, '#1 both rows should be pending and share one swap_id');
  end if;
  if not exists (select 1 from public.change_requests
                 where batch_id = v_batch and from_date = v_mon and to_date = v_wed and session_name = 'Push Day')
     or not exists (select 1 from public.change_requests
                 where batch_id = v_batch and from_date = v_wed and to_date = v_mon and session_name = 'Pull Day') then
    failures := array_append(failures, '#1 rows should be A->B and B->A with session_name snapshots');
  end if;
  if (select name from public.sessions where id = public.resolve_scheduled_workout(client_a, v_mon)) <> 'Push Day' then
    failures := array_append(failures, '#1 filing must not move anything before a decision');
  end if;

  -- Both days leave the offered list while pending.
  v_result := public.get_movable_days();
  if (v_result->'upcoming') @> jsonb_build_array(jsonb_build_object('date', v_mon)) then
    failures := array_append(failures, '#1 a day in a pending swap should not be offered again');
  end if;
  if (select count(*) from jsonb_array_elements(v_result->'pending') p where p->>'swap_id' is not null) <> 2 then
    failures := array_append(failures, '#1 get_movable_days should report swap_id on both pending rows');
  end if;

  -- ---------------------------------------------------------------------
  -- 2. A retried submission does nothing the second time (C4)
  -- ---------------------------------------------------------------------
  v_result := public.request_schedule_swap(v_batch, v_mon, v_wed);
  if not (v_result->>'duplicate')::boolean
     or (select count(*) from public.change_requests where batch_id = v_batch) <> 2 then
    failures := array_append(failures, '#2 a retried swap must be recognised and write nothing');
  end if;

  -- ---------------------------------------------------------------------
  -- 3. Filing validates server-side
  -- ---------------------------------------------------------------------
  -- A rest day has nothing to swap.
  v_caught := null;
  begin
    perform public.request_schedule_swap(gen_random_uuid(), v_mon2, v_mon2 + 1);
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like 'nothing_to_move%' then
    failures := array_append(failures, format('#3 rest day: expected nothing_to_move, got %s', v_caught));
  end if;

  -- The same day twice.
  v_caught := null;
  begin
    perform public.request_schedule_swap(gen_random_uuid(), v_mon2, v_mon2);
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like 'invalid_moves%' then
    failures := array_append(failures, format('#3 same day: expected invalid_moves, got %s', v_caught));
  end if;

  -- A day already waiting on a decision.
  v_caught := null;
  begin
    perform public.request_schedule_swap(gen_random_uuid(), v_mon, v_mon2);
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null then
    failures := array_append(failures, '#3 a day already in a pending swap must be refused');
  end if;

  -- A day in the client's past cannot be a side of a swap.
  v_caught := null;
  begin
    perform public.request_schedule_swap(gen_random_uuid(), v_mon2, (date_trunc('week', v_today)::date) - 5);
  exception when others then v_caught := sqlerrm;
  end;
  if v_caught is null then
    failures := array_append(failures, '#3 a day in the past must be refused');
  end if;

  -- ---------------------------------------------------------------------
  -- 4. Withdrawing either half withdraws both (and is idempotent)
  -- ---------------------------------------------------------------------
  select array_agg(id) into v_ids from public.change_requests where batch_id = v_batch and position = 1;
  if public.cancel_schedule_moves(v_ids) <> 2 then
    failures := array_append(failures, '#4 withdrawing one half should withdraw both');
  end if;
  if exists (select 1 from public.change_requests where batch_id = v_batch and status <> 'cancelled') then
    failures := array_append(failures, '#4 both rows should be cancelled');
  end if;
  if public.cancel_schedule_moves(v_ids) <> 0 then
    failures := array_append(failures, '#4 withdrawing again should count nothing');
  end if;

  -- ---------------------------------------------------------------------
  -- 5. Coach accepts via either half: both days trade places, atomically
  -- ---------------------------------------------------------------------
  v_batch := gen_random_uuid();
  select count(*) into v_sessions_before from public.sessions;
  perform public.request_schedule_swap(v_batch, v_mon, v_wed);
  select array_agg(id) into v_ids from public.change_requests where batch_id = v_batch and position = 2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  v_result := public.decide_schedule_moves(v_ids, 'accept');
  if (v_result->>'applied')::int is distinct from 2 or jsonb_array_length(v_result->'skipped') <> 0 then
    failures := array_append(failures, format('#5 expected 2 applied and nothing skipped, got %s', v_result));
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  select name into v_name_mon from public.sessions where id = public.resolve_scheduled_workout(client_a, v_mon);
  select name into v_name_wed from public.sessions where id = public.resolve_scheduled_workout(client_a, v_wed);
  if v_name_mon is distinct from 'Pull Day' or v_name_wed is distinct from 'Push Day' then
    failures := array_append(failures, format('#5 days should have traded places, got Mon=%s Wed=%s', v_name_mon, v_name_wed));
  end if;
  if (select count(*) from public.change_requests where batch_id = v_batch and status = 'accepted') <> 2 then
    failures := array_append(failures, '#5 both rows should be accepted');
  end if;
  -- R10: schedule overrides only; the sessions themselves are untouched.
  if (select count(*) from public.sessions) <> v_sessions_before then
    failures := array_append(failures, '#5 a swap must not write sessions rows');
  end if;
  if (select count(*) from public.workout_logs where client_id = client_a) <> 0 then
    failures := array_append(failures, '#5 a swap must not write workout_logs');
  end if;

  -- Deciding again reports the pair as already handled; nothing applies twice.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  v_result := public.decide_schedule_moves(v_ids, 'accept');
  if (v_result->>'applied')::int <> 0 or jsonb_array_length(v_result->'skipped') = 0 then
    failures := array_append(failures, format('#5 a second accept must apply nothing, got %s', v_result));
  end if;

  -- ---------------------------------------------------------------------
  -- 6. Rejecting one half rejects both and changes nothing
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  v_batch := gen_random_uuid();
  perform public.request_schedule_swap(v_batch, v_mon2, v_mon2 + 2);
  select array_agg(id) into v_ids from public.change_requests where batch_id = v_batch and position = 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  v_result := public.decide_schedule_moves(v_ids, 'reject');
  if (v_result->>'rejected')::int is distinct from 2 then
    failures := array_append(failures, format('#6 expected 2 rejected, got %s', v_result));
  end if;
  if exists (select 1 from public.change_requests where batch_id = v_batch and status <> 'rejected') then
    failures := array_append(failures, '#6 both rows should be rejected');
  end if;

  -- ---------------------------------------------------------------------
  -- 7. A day logged before the coach decides skips the whole pair (C5)
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  v_batch := gen_random_uuid();
  perform public.request_schedule_swap(v_batch, v_mon2, v_mon2 + 2);
  select array_agg(id) into v_ids from public.change_requests where batch_id = v_batch and position = 1;

  insert into public.workout_logs (client_id, date, session_id)
  values (client_a, v_mon2, public.resolve_scheduled_workout(client_a, v_mon2));

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);
  v_result := public.decide_schedule_moves(v_ids, 'accept');
  if (v_result->>'applied')::int <> 0
     or not exists (select 1 from public.change_requests
                    where batch_id = v_batch and status = 'skipped' and skip_reason = 'already_logged'
                    having count(*) = 2) then
    failures := array_append(failures, format('#7 a logged day should skip both rows as already_logged, got %s', v_result));
  end if;
  if (select name from public.sessions where id = public.resolve_scheduled_workout(client_a, v_mon2 + 2)) <> 'Pull Day' then
    failures := array_append(failures, '#7 a skipped swap must leave the other day alone');
  end if;

  -- ---------------------------------------------------------------------
  -- 8. Auto-approval applies the swap at filing time
  -- ---------------------------------------------------------------------
  update public.profiles set move_approval = 'auto' where id = client_a;

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  v_batch := gen_random_uuid();
  v_result := public.request_schedule_swap(v_batch, v_mon + 7 * 2, v_mon + 7 * 2 + 2);
  if (v_result->>'applied')::int is distinct from 2 or not (v_result->>'auto_applied')::boolean then
    failures := array_append(failures, format('#8 auto swap should apply 2, got %s', v_result));
  end if;
  if (select name from public.sessions where id = public.resolve_scheduled_workout(client_a, v_mon + 14)) <> 'Pull Day' then
    failures := array_append(failures, '#8 auto swap should have traded the days');
  end if;
  if (select count(*) from public.change_requests
      where batch_id = v_batch and status = 'accepted' and auto_applied) <> 2 then
    failures := array_append(failures, '#8 both rows should be accepted and marked auto_applied (C8)');
  end if;

  if cardinality(failures) > 0 then
    raise exception 'schedule swap assertions FAILED: %', array_to_string(failures, E'\n  ');
  end if;
  raise notice 'schedule swap assertions PASSED';
end;
$$;

rollback;
