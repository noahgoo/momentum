-- Assertions for migration 0039 (four gaps found reviewing 0030-0038).
--
-- Same rollback-safe shape as the other suites: one transaction, one DO
-- block accumulating failures, always raising PASSED/FAILED at the end.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0039_review_findings_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_a  uuid := 'f9000000-0000-0000-0000-000000000001';
  coach_b  uuid := 'f9000000-0000-0000-0000-000000000002';
  client_a uuid := 'f9000000-0000-0000-0000-00000000000a';

  tmpl_a   uuid := 'f9100000-0000-0000-0000-000000000001';
  w_a      uuid := 'f9200000-0000-0000-0000-000000000001'; -- coach A's own workout
  w_b      uuid := 'f9200000-0000-0000-0000-000000000002'; -- coach B's workout
  ex_bench uuid := 'f9300000-0000-0000-0000-000000000001';

  v_start date := date_trunc('week', current_date)::date;
  v_payload jsonb;
  v_assignment uuid;
  v_instance_program uuid;
  v_raised text;
  v_count int;
  v_scheduled uuid;
  v_foreign_session uuid;
  v_log_id uuid;
begin
  -- -----------------------------------------------------------------------
  -- Fixtures
  -- -----------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_a, 'review-coach-a@test.local',
      jsonb_build_object('role','coach','display_name','Review Coach A')),
    (coach_b, 'review-coach-b@test.local',
      jsonb_build_object('role','coach','display_name','Review Coach B')),
    (client_a, 'review-client-a@test.local',
      jsonb_build_object('role','client','display_name','Review Client A','invited_by',coach_a::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_bench, 'Bench', coach_a);
  insert into public.workouts (id, name, type, created_by) values (w_a, 'Coach A Push', 'workout', coach_a);
  insert into public.workouts (id, name, type, created_by) values (w_b, 'Coach B Private', 'workout', coach_b);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_a, ex_bench, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_b, ex_bench, 0, 'reps', '[{"reps":5,"weight":200,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (tmpl_a, 'Review Template', 2, coach_a);

  perform set_config('request.jwt.claims', json_build_object('sub', coach_a)::text, true);

  -- =========================================================================
  -- 1. save_program refuses to schedule another coach's workout
  -- =========================================================================
  v_payload := jsonb_build_object(
    'name', 'Review Template', 'description', null, 'weeks', 2,
    'phased', false, 'phases', '[]'::jsonb,
    'slots', jsonb_build_array(
      jsonb_build_object('week_number', 1, 'day_of_week', 'monday', 'workout_id', w_b)
    )
  );

  begin
    perform public.save_program(v_payload, tmpl_a, null);
    failures := array_append(failures, 'save_program accepted a slot referencing another coach''s workout');
  exception when others then
    v_raised := sqlerrm;
    if v_raised <> 'not_found_or_forbidden' then
      failures := array_append(failures, format('expected not_found_or_forbidden, got: %s', v_raised));
    end if;
  end;

  select count(*) into v_count from public.sessions where program_id = tmpl_a;
  if v_count <> 0 then
    failures := array_append(failures, 'the refused slot still materialized a session');
  end if;

  -- The same payload with the coach's own workout succeeds — the guard is
  -- ownership-scoped, not a blanket refusal.
  v_payload := jsonb_set(v_payload, '{slots}', jsonb_build_array(
    jsonb_build_object('week_number', 1, 'day_of_week', 'monday', 'workout_id', w_a)
  ));
  begin
    perform public.save_program(v_payload, tmpl_a, null);
  exception when others then
    failures := array_append(failures, format('save_program refused the coach''s own workout: %L', sqlerrm));
  end;

  if not exists (select 1 from public.sessions where program_id = tmpl_a and source_workout_id = w_a) then
    failures := array_append(failures, 'a slot referencing the coach''s own workout did not materialize');
  end if;

  -- =========================================================================
  -- 2. RLS: an instance program can't be rewritten by a raw update, even
  --    though the same coach can still update their own template directly.
  -- =========================================================================
  v_assignment := public.assign_program(client_a, tmpl_a, v_start);
  select program_id into v_instance_program from public.assignments where id = v_assignment;

  set local role authenticated;

  update public.programs set weeks = 99 where id = v_instance_program;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    failures := array_append(failures, 'a raw update reached a client''s instance program under RLS');
  end if;

  update public.programs set weeks = 3 where id = tmpl_a;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    failures := array_append(failures, 'a raw update to the coach''s own TEMPLATE was blocked — the policy is too strict');
  end if;

  reset role;

  select weeks into v_count from public.programs where id = v_instance_program;
  if v_count = 99 then
    failures := array_append(failures, 'the instance program''s weeks changed despite RLS');
  end if;

  -- =========================================================================
  -- 3. save_workout_log refuses a foreign session id, and stays editable
  --    across a reschedule that keeps the old session row alive
  -- =========================================================================
  select s.id into v_scheduled
  from public.sessions s
  where s.program_id = v_instance_program and s.week_number = 1 and s.day_of_week = 'monday';

  -- An unrelated session the client has no claim to (a second, unassigned
  -- template's slot).
  perform public.materialize_session(tmpl_a, null, 2, 'monday', w_b);
  select id into v_foreign_session
  from public.sessions where program_id = tmpl_a and week_number = 2 and day_of_week = 'monday';

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  begin
    perform public.save_workout_log(v_start, v_foreign_session, true, '[]'::jsonb);
    failures := array_append(failures, 'save_workout_log accepted a foreign session id on a scheduled date');
  exception when others then
    v_raised := sqlerrm;
    if v_raised <> 'not_scheduled' then
      failures := array_append(failures, format('expected not_scheduled, got: %s', v_raised));
    end if;
  end;

  if exists (select 1 from public.workout_logs where client_id = client_a and date = v_start) then
    failures := array_append(failures, 'the refused foreign-session log still wrote a row');
  end if;

  -- The legitimately resolved session is accepted.
  v_log_id := public.save_workout_log(v_start, v_scheduled, false, '[]'::jsonb);
  if v_log_id is null then
    failures := array_append(failures, 'save_workout_log rejected the actually-scheduled session');
  end if;

  select session_name into v_raised from public.workout_logs where id = v_log_id;
  if v_raised is distinct from 'Coach A Push' then
    failures := array_append(failures, format('session_name should snapshot the scheduled session, got %s', coalesce(v_raised, 'null')));
  end if;

  -- Now the coach re-points that slot at a different assignment-visible
  -- session (an override), so resolve_scheduled_workout(v_start) changes
  -- while the client's existing log still names the old (still-live)
  -- session. Re-saving with the OLD id must still work (the client did the
  -- work; the record stays) — but a THIRD, unrelated session must not.
  perform set_config('request.jwt.claims', json_build_object('sub', coach_a)::text, true);
  insert into public.assignment_date_overrides (assignment_id, date, session_id)
  values (v_assignment, v_start, v_foreign_session)
  on conflict (assignment_id, date) do update set session_id = excluded.session_id;

  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  begin
    perform public.save_workout_log(v_start, v_scheduled, true, '[]'::jsonb);
  exception when others then
    failures := array_append(failures, format('editing an existing log after a reschedule should stay allowed: %L', sqlerrm));
  end;

  -- A session that is neither the (now-overridden) resolution nor the log's
  -- own prior session must still be refused.
  perform public.materialize_session(tmpl_a, null, 1, 'tuesday', w_a);
  begin
    perform public.save_workout_log(
      v_start,
      (select id from public.sessions where program_id = tmpl_a and week_number = 1 and day_of_week = 'tuesday'),
      true, '[]'::jsonb
    );
    failures := array_append(failures, 'save_workout_log accepted a third, unrelated session id on an already-logged date');
  exception when others then
    v_raised := sqlerrm;
    if v_raised <> 'not_scheduled' then
      failures := array_append(failures, format('expected not_scheduled, got: %s', v_raised));
    end if;
  end;

  -- =========================================================================
  -- 4. save_workout: omitting client_id from the payload keeps the
  --    workout's existing scope instead of clearing it
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', coach_a)::text, true);

  perform public.save_workout(
    jsonb_build_object(
      'name', 'Shelf Workout', 'client_id', client_a, 'weeks', null,
      'exercises', '[]'::jsonb
    ),
    null, null
  );

  declare
    v_shelf_id uuid;
  begin
    select id into v_shelf_id from public.workouts where name = 'Shelf Workout' and created_by = coach_a;

    -- Re-save WITHOUT client_id in the payload at all — must not clear it.
    perform public.save_workout(
      jsonb_build_object('name', 'Shelf Workout Renamed', 'exercises', '[]'::jsonb),
      v_shelf_id, null
    );

    if not exists (select 1 from public.workouts where id = v_shelf_id and client_id = client_a) then
      failures := array_append(failures, 'omitting client_id from the payload cleared the workout''s existing shelf scope');
    end if;

    -- An explicit client_id key of null DOES clear it — the key controls
    -- intent, not merely a truthy value.
    perform public.save_workout(
      jsonb_build_object('name', 'Shelf Workout Renamed', 'client_id', null, 'exercises', '[]'::jsonb),
      v_shelf_id, null
    );
    if not exists (select 1 from public.workouts where id = v_shelf_id and client_id is null) then
      failures := array_append(failures, 'an explicit null client_id should still clear the shelf scope');
    end if;
  end;

  -- -----------------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise notice 'PASSED: 0039 review findings';
  else
    raise exception E'FAILED:\n  %', array_to_string(failures, E'\n  ');
  end if;
end;
$$;

rollback;
