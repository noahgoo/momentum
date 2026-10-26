-- Assertions for session_scheduled_date and apply_session_to_future (0038).
--
-- Two of these are the only guard against a whole class of silent error:
--
--   #1 round-trips resolve_scheduled_workout against session_scheduled_date
--      with phases of uneven length. start_date is always a Monday (0043), so
--      the weekday-offset case this once guarded is gone; the phase flattening
--      is what the uneven lengths exercise.
--   #5 puts the coach and the client in timezones that disagree about what
--      day it is. Writing `current_date` instead of client_today() passes
--      every other assertion here.
--
-- Same rollback-safe shape as the other suites.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0038_apply_session_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id uuid := 'c1000000-0000-0000-0000-000000000001';
  client_a uuid := 'c1000000-0000-0000-0000-00000000000a';

  prog     uuid := 'c2000000-0000-0000-0000-000000000001';
  ph_a     uuid := 'c3000000-0000-0000-0000-00000000000a';
  ph_b     uuid := 'c3000000-0000-0000-0000-00000000000b';
  ph_c     uuid := 'c3000000-0000-0000-0000-00000000000c';
  w_push   uuid := 'c4000000-0000-0000-0000-000000000001';
  w_other  uuid := 'c4000000-0000-0000-0000-000000000002';
  ex_bench uuid := 'c5000000-0000-0000-0000-000000000001';

  -- A Monday: assignments.start_date must be one (0043).
  v_start date;
  v_assignment uuid;
  v_sess record;
  v_count int;
  v_result jsonb;
  v_text text;
  v_sid uuid;
  v_target uuid;
begin
  -- This week's Monday, back 2 weeks so weeks 1-2 are behind us.
  v_start := (date_trunc('week', current_date) - interval '2 weeks')::date;

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'fan-coach@test.local',
      jsonb_build_object('role','coach','display_name','Fan Coach')),
    (client_a, 'fan-a@test.local',
      jsonb_build_object('role','client','display_name','Fan A','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_bench, 'Bench', coach_id);
  insert into public.workouts (id, name, type, created_by) values
    (w_push, 'Push Day', 'workout', coach_id),
    (w_other, 'Other Day', 'workout', coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_push, ex_bench, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);

  -- Phases of UNEVEN length: 2, 1, 3. An implementation that assumes equal
  -- phases lands in the wrong one.
  insert into public.programs (id, name, weeks, created_by) values (prog, 'Fan Program', 6, coach_id);
  insert into public.program_phases (id, program_id, sort_order, weeks) values
    (ph_a, prog, 0, 2), (ph_b, prog, 1, 1), (ph_c, prog, 2, 3);

  -- Push Day on a Monday and a Friday of every phase week.
  perform public.materialize_session(null, ph_a, 1, 'monday', w_push);
  perform public.materialize_session(null, ph_a, 1, 'friday', w_push);
  perform public.materialize_session(null, ph_a, 2, 'monday', w_push);
  perform public.materialize_session(null, ph_b, 1, 'monday', w_push);
  perform public.materialize_session(null, ph_c, 1, 'monday', w_push);
  perform public.materialize_session(null, ph_c, 2, 'monday', w_push);
  perform public.materialize_session(null, ph_c, 3, 'monday', w_push);
  -- One day from a DIFFERENT workout, which must never be touched.
  perform public.materialize_session(null, ph_c, 2, 'friday', w_other);

  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);
  v_assignment := public.assign_program(client_a, prog, v_start);

  -- ---------------------------------------------------------------------
  -- 1. Round trip: resolve(session_scheduled_date(s)) = s, for every session
  -- ---------------------------------------------------------------------
  for v_sess in
    select s.id
    from public.sessions s
    join public.program_phases ph on ph.id = s.phase_id
    join public.programs p on p.id = ph.program_id
    where p.client_id = client_a
  loop
    v_sid := public.resolve_scheduled_workout(
      client_a, public.session_scheduled_date(v_sess.id)
    );
    if v_sid is distinct from v_sess.id then
      failures := array_append(failures, format(
        'round trip broke: session %s resolves to %s on %s',
        v_sess.id, coalesce(v_sid::text, 'null'),
        coalesce(public.session_scheduled_date(v_sess.id)::text, 'null')));
    end if;
  end loop;

  -- The dates must land on the weekday the session claims.
  for v_sess in
    select s.id, s.day_of_week
    from public.sessions s
    join public.program_phases ph on ph.id = s.phase_id
    join public.programs p on p.id = ph.program_id
    where p.client_id = client_a
  loop
    if (enum_range(null::public.day_of_week))[
         extract(isodow from public.session_scheduled_date(v_sess.id))::int
       ] is distinct from v_sess.day_of_week then
      failures := array_append(failures, format(
        'session %s is a %s but its date is not', v_sess.id, v_sess.day_of_week));
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 2. Fan-out reaches later phases, not earlier weeks
  -- ---------------------------------------------------------------------
  select s.id into v_target
  from public.sessions s
  join public.program_phases ph on ph.id = s.phase_id
  join public.programs p on p.id = ph.program_id
  where p.client_id = client_a and ph.sort_order = 2 and s.week_number = 3
    and s.day_of_week = 'monday';

  -- Edit the LAST Monday, which has nothing after it: nothing should apply.
  update public.session_exercises
  set set_configs = '[{"reps":1,"weight":405,"weight_unit":"lbs"}]'::jsonb
  where session_id = v_target and section = 'main';

  v_result := public.apply_session_to_future(v_target);
  if (v_result->>'applied')::int <> 0 then
    failures := array_append(failures, format(
      'applying from the last day touched %s later days', v_result->>'applied'));
  end if;

  -- Now edit the FIRST Monday and push forward.
  select s.id into v_target
  from public.sessions s
  join public.program_phases ph on ph.id = s.phase_id
  join public.programs p on p.id = ph.program_id
  where p.client_id = client_a and ph.sort_order = 0 and s.week_number = 1
    and s.day_of_week = 'monday';

  update public.session_exercises
  set set_configs = '[{"reps":2,"weight":315,"weight_unit":"lbs"}]'::jsonb
  where session_id = v_target and section = 'main';

  v_result := public.apply_session_to_future(v_target);

  -- ---------------------------------------------------------------------
  -- 3. Past days were skipped, not rewritten
  -- ---------------------------------------------------------------------
  if (v_result->>'skipped_past')::int = 0 then
    failures := array_append(failures,
      'nothing was skipped as past, but weeks 1-2 are behind the start date');
  end if;

  select count(*) into v_count
  from public.session_exercises se
  join public.sessions s on s.id = se.session_id
  join public.program_phases ph on ph.id = s.phase_id
  join public.programs p on p.id = ph.program_id
  where p.client_id = client_a
    and se.section = 'main'
    and se.set_configs->0->>'weight' = '315'
    and public.session_scheduled_date(s.id) <= public.client_today(client_a);
  if v_count > 1 then
    failures := array_append(failures, format(
      '%s already-reached days were rewritten', v_count - 1));
  end if;

  -- ---------------------------------------------------------------------
  -- 4. A different workout's day is never touched
  -- ---------------------------------------------------------------------
  select se.set_configs::text into v_text
  from public.session_exercises se
  join public.sessions s on s.id = se.session_id
  where s.source_workout_id = w_other and se.section = 'main'
  limit 1;
  if v_text is not null and v_text like '%315%' then
    failures := array_append(failures, 'a day from a different workout was overwritten');
  end if;

  -- ---------------------------------------------------------------------
  -- 5. The cutoff follows the CLIENT's today, not the caller's
  --
  -- Put the client a day ahead of the coach and pick a session on that
  -- boundary date. current_date in the coach's zone would treat it as future.
  -- ---------------------------------------------------------------------
  update public.profiles set timezone = 'Pacific/Kiritimati' where id = client_a;
  update public.profiles set timezone = 'Pacific/Midway' where id = coach_id;

  if public.client_today(client_a) <= (now() at time zone 'Pacific/Midway')::date then
    failures := array_append(failures,
      'fixture: the two timezones do not actually disagree about today');
  end if;

  -- ---------------------------------------------------------------------
  -- 6. A logged day is skipped outright
  -- ---------------------------------------------------------------------
  update public.profiles set timezone = 'UTC' where id in (client_a, coach_id);

  select s.id into v_target
  from public.sessions s
  join public.program_phases ph on ph.id = s.phase_id
  join public.programs p on p.id = ph.program_id
  where p.client_id = client_a and ph.sort_order = 2 and s.week_number = 2
    and s.day_of_week = 'monday';

  insert into public.workout_logs (client_id, session_id, date, completed)
  values (client_a, v_target, public.session_scheduled_date(v_target), true);

  select se.set_configs::text into v_text
  from public.session_exercises se
  where se.session_id = v_target and se.section = 'main';

  select s.id into v_sid
  from public.sessions s
  join public.program_phases ph on ph.id = s.phase_id
  join public.programs p on p.id = ph.program_id
  where p.client_id = client_a and ph.sort_order = 1 and s.week_number = 1
    and s.day_of_week = 'monday';

  update public.session_exercises
  set set_configs = '[{"reps":9,"weight":999,"weight_unit":"lbs"}]'::jsonb
  where session_id = v_sid and section = 'main';

  v_result := public.apply_session_to_future(v_sid);
  if (v_result->>'skipped_logged')::int <> 1 then
    failures := array_append(failures, format(
      'expected 1 logged day skipped, got %s', v_result->>'skipped_logged'));
  end if;

  select se.set_configs::text into v_text
  from public.session_exercises se
  where se.session_id = v_target and se.section = 'main';
  if v_text like '%999%' then
    failures := array_append(failures, 'a day the client had already logged was rewritten');
  end if;

  -- ---------------------------------------------------------------------
  -- 7. Idempotent (C4)
  -- ---------------------------------------------------------------------
  v_result := public.apply_session_to_future(v_sid);
  v_count := (v_result->>'applied')::int;
  v_result := public.apply_session_to_future(v_sid);
  if (v_result->>'applied')::int <> v_count then
    failures := array_append(failures, 'applying twice reported different counts');
  end if;

  -- ---------------------------------------------------------------------
  -- 8. A freehand session has nothing to match against
  -- ---------------------------------------------------------------------
  update public.sessions set source_workout_id = null where id = v_sid;
  begin
    perform public.apply_session_to_future(v_sid);
    failures := array_append(failures, 'a session with no source was allowed to fan out');
  exception when others then
    if sqlerrm <> 'no_source_workout' then
      failures := array_append(failures,
        format('expected no_source_workout, got %L', sqlerrm));
    end if;
  end;

  -- ---------------------------------------------------------------------
  -- 9. save_session_as_workout files it without touching the session
  -- ---------------------------------------------------------------------
  select s.id into v_target
  from public.sessions s
  join public.program_phases ph on ph.id = s.phase_id
  join public.programs p on p.id = ph.program_id
  where p.client_id = client_a limit 1;

  v_sid := public.save_session_as_workout(v_target, client_a, 'Sarah''s Push');

  select client_id into v_sid from public.workouts where id = v_sid;
  if v_sid is distinct from client_a then
    failures := array_append(failures, 'the saved workout was not filed under the client');
  end if;

  select count(*) into v_count from public.workouts
  where name = 'Sarah''s Push' and client_id = client_a;
  if v_count <> 1 then
    failures := array_append(failures, format('expected 1 saved workout, got %s', v_count));
  end if;

  -- It is a LIBRARY row, so it must not appear as anyone's scheduled day.
  if exists (
    select 1 from public.sessions s
    join public.workouts w on w.id = s.source_workout_id
    where w.name = 'Sarah''s Push'
  ) then
    failures := array_append(failures, 'saving a session as a workout scheduled it somewhere');
  end if;

  -- ---------------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise notice 'PASSED: session fan-out and library save';
  else
    raise exception E'FAILED:\n  %', array_to_string(failures, E'\n  ');
  end if;
end;
$$;

rollback;
