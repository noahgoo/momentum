-- Assertions for 0043: assignments start on a Monday.
--
-- Covers the going-forward rule (assign_program, the CHECK constraint, the
-- date inverse). The date-preserving backfill of pre-0043 rows is a one-shot
-- DO block in the migration; it was verified against seed data and a
-- prior-assignment overlap fixture before it ran, not re-run here.
--
-- Same rollback-safe shape as the other suites.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0043_start_on_monday_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id uuid := 'd1000000-0000-0000-0000-000000000001';
  client_a uuid := 'd1000000-0000-0000-0000-00000000000a';

  tmpl     uuid := 'd2000000-0000-0000-0000-000000000001';
  w_push   uuid := 'd4000000-0000-0000-0000-000000000001';
  ex_bench uuid := 'd5000000-0000-0000-0000-000000000001';

  v_monday date := date_trunc('week', current_date)::date;
  v_past_monday date := date_trunc('week', current_date)::date - 14;
  v_assignment uuid;
  v_session uuid;
  v_err text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'mon-coach@test.local', jsonb_build_object('role','coach','display_name','Mon Coach')),
    (client_a, 'mon-a@test.local',
      jsonb_build_object('role','client','display_name','Mon A','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_bench, 'Bench', coach_id);
  insert into public.workouts (id, name, type, created_by) values (w_push, 'Push Day', 'workout', coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_push, ex_bench, 0, 'reps', '[{"reps":5}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (tmpl, 'Monday Program', 2, coach_id);
  perform public.materialize_session(tmpl, null, 1, 'monday', w_push);
  perform public.materialize_session(tmpl, null, 2, 'friday', w_push);

  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);

  -- 1. A non-Monday start is refused with the domain error, for every weekday.
  for i in 1..6 loop
    begin
      perform public.assign_program(client_a, tmpl, v_monday + i);
      failures := array_append(failures, format('assign_program accepted a start %s days after a Monday', i));
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err <> 'start_date_must_be_monday' then
        failures := array_append(failures, format('wrong error for weekday offset %s: %s', i, v_err));
      end if;
    end;
  end loop;

  -- 2. NULL is refused too, not stored.
  begin
    perform public.assign_program(client_a, tmpl, null);
    failures := array_append(failures, 'assign_program accepted a NULL start');
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'start_date_must_be_monday' then
      failures := array_append(failures, format('wrong error for NULL start: %s', v_err));
    end if;
  end;

  -- 3. A past Monday is allowed, and the date inverse lands each session on
  --    its own weekday, week-aligned.
  v_assignment := public.assign_program(client_a, tmpl, v_past_monday);
  if (select start_date from public.assignments where id = v_assignment) <> v_past_monday then
    failures := array_append(failures, 'past Monday start was not stored as given');
  end if;

  select s.id into v_session
  from public.sessions s join public.assignments a on a.program_id = s.program_id
  where a.id = v_assignment and s.week_number = 2 and s.day_of_week = 'friday';
  if public.session_scheduled_date(v_session) <> v_past_monday + 7 + 4 then
    failures := array_append(failures, format('week 2 Friday is %s, expected %s',
      public.session_scheduled_date(v_session), v_past_monday + 11));
  end if;
  if public.resolve_scheduled_workout(client_a, v_past_monday + 11) is distinct from v_session then
    failures := array_append(failures, 'resolve does not round-trip week 2 Friday');
  end if;

  -- 4. The CHECK backstops a write that bypasses the RPC.
  begin
    update public.assignments set start_date = v_past_monday + 2 where id = v_assignment;
    failures := array_append(failures, 'assignments accepted a non-Monday start_date directly');
  exception when check_violation then
    null;
  end;

  raise exception 'START_ON_MONDAY_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
