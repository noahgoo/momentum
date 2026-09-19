-- Assertions for the sessions tables (migration 0031).
--
-- 0031 is purely additive: nothing populates or reads sessions yet, so what
-- there is to check is the shape and the policies. RLS is the point — these
-- tables will carry every client's schedule, and a policy that is wrong here
-- is wrong for every client at once.
--
-- Same rollback-safe shape as the other suites: one transaction, one DO block
-- accumulating failures, always raising PASSED/FAILED at the end.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0031_sessions_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id  uuid := 'af000000-0000-0000-0000-000000000001';
  coach_two uuid := 'af000000-0000-0000-0000-000000000002';
  client_a  uuid := 'af000000-0000-0000-0000-00000000000a';
  client_b  uuid := 'af000000-0000-0000-0000-00000000000b';

  flat_program  uuid := 'cf000000-0000-0000-0000-000000000001';
  phased_program uuid := 'cf000000-0000-0000-0000-000000000002';
  phase_one     uuid := 'df000000-0000-0000-0000-000000000001';
  w_push        uuid := 'bf000000-0000-0000-0000-000000000001';
  ex_bench      uuid := 'ef000000-0000-0000-0000-000000000001';

  s_flat   uuid := 'a1000000-0000-0000-0000-000000000001';
  s_phased uuid := 'a1000000-0000-0000-0000-000000000002';

  v_start date := date_trunc('week', current_date)::date;
  v_count int;
  v_raised text;
begin
  -- -----------------------------------------------------------------------
  -- Fixtures: one flat program and one phased, each with a session.
  -- client_a is assigned the flat one; client_b is assigned nothing.
  -- -----------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'sess-coach@test.local',
      jsonb_build_object('role','coach','display_name','Sess Coach')),
    (coach_two, 'sess-coach2@test.local',
      jsonb_build_object('role','coach','display_name','Other Coach')),
    (client_a, 'sess-a@test.local',
      jsonb_build_object('role','client','display_name','Sess A','invited_by',coach_id::text)),
    (client_b, 'sess-b@test.local',
      jsonb_build_object('role','client','display_name','Sess B','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_bench, 'Bench', coach_id);
  insert into public.workouts (id, name, type, created_by)
  values (w_push, 'Push Day', 'workout', coach_id);

  insert into public.programs (id, name, weeks, created_by, client_id)
  values (flat_program, 'Flat', 2, coach_id, client_a);
  insert into public.programs (id, name, weeks, created_by)
  values (phased_program, 'Phased', 2, coach_id);
  insert into public.program_phases (id, program_id, sort_order, weeks)
  values (phase_one, phased_program, 0, 2);

  insert into public.sessions (id, program_id, week_number, day_of_week, source_workout_id, name)
  values (s_flat, flat_program, 1, 'monday', w_push, 'Push Day');
  insert into public.sessions (id, phase_id, week_number, day_of_week, source_workout_id, name)
  values (s_phased, phase_one, 1, 'monday', w_push, 'Push Day');

  insert into public.session_exercises (session_id, section, exercise_id, sort_order, mode, set_configs)
  values
    (s_flat, 'warmup', ex_bench, 0, 'reps', '[{"reps":10}]'::jsonb),
    (s_flat, 'main',   ex_bench, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);

  insert into public.assignments (client_id, program_id, start_date, active)
  values (client_a, flat_program, v_start, true);

  -- -----------------------------------------------------------------------
  -- 1. Scope check: exactly one of program_id / phase_id
  -- -----------------------------------------------------------------------
  begin
    insert into public.sessions (program_id, phase_id, week_number, day_of_week, name)
    values (flat_program, phase_one, 9, 'friday', 'Both scopes');
    failures := array_append(failures, 'sessions accepted both program_id and phase_id');
  exception when check_violation then
    null;
  end;

  begin
    insert into public.sessions (week_number, day_of_week, name)
    values (9, 'friday', 'No scope');
    failures := array_append(failures, 'sessions accepted neither program_id nor phase_id');
  exception when check_violation then
    null;
  end;

  -- -----------------------------------------------------------------------
  -- 2. One session per (scope, week, day)
  -- -----------------------------------------------------------------------
  begin
    insert into public.sessions (program_id, week_number, day_of_week, name)
    values (flat_program, 1, 'monday', 'Duplicate');
    failures := array_append(failures, 'a second session landed on the same program week/day');
  exception when unique_violation then
    null;
  end;

  -- -----------------------------------------------------------------------
  -- 3. sort_order is per-section, not per-session
  --
  -- If this constraint were (session_id, sort_order), a session could not hold
  -- a warm-up and a main exercise that both sort first — which every session
  -- with a warm-up does.
  -- -----------------------------------------------------------------------
  if not exists (
    select 1 from public.session_exercises
    where session_id = s_flat and section = 'warmup' and sort_order = 0
  ) or not exists (
    select 1 from public.session_exercises
    where session_id = s_flat and section = 'main' and sort_order = 0
  ) then
    failures := array_append(failures,
      'a session could not hold a warmup and a main exercise at the same sort_order');
  end if;

  -- The constraint is DEFERRABLE INITIALLY DEFERRED, like workout_exercises',
  -- so a reconcile can reorder rows mid-transaction without tripping over
  -- itself. That means it is not checked at statement time and this insert
  -- succeeds here — `set constraints immediate` is what forces the check.
  -- Testing it with a plain exception block silently passes against a table
  -- with no constraint at all.
  begin
    insert into public.session_exercises (session_id, section, exercise_id, sort_order)
    values (s_flat, 'main', ex_bench, 0);
    set constraints public.session_exercises_session_id_section_sort_order_key immediate;
    failures := array_append(failures, 'a duplicate (session, section, sort_order) was accepted');
  exception when unique_violation then
    null;
  end;
  set constraints all deferred;
  delete from public.session_exercises
  where session_id = s_flat and section = 'main' and sort_order = 0
    and ctid <> (
      select min(ctid) from public.session_exercises
      where session_id = s_flat and section = 'main' and sort_order = 0
    );

  -- -----------------------------------------------------------------------
  -- 4. set_configs validation reaches session_exercises (0027's check)
  -- -----------------------------------------------------------------------
  begin
    insert into public.session_exercises (session_id, section, exercise_id, sort_order, set_configs)
    values (s_flat, 'main', ex_bench, 5, '[{"reps":5,"bogus_key":1}]'::jsonb);
    failures := array_append(failures, 'session_exercises accepted a set_config with an unknown key');
  exception when check_violation then
    null;
  end;

  -- -----------------------------------------------------------------------
  -- 5. Deleting a library workout leaves the session standing
  --
  -- source_workout_id is provenance, not a dependency (R4). A coach tidying
  -- their library must never blank a client's scheduled day.
  -- -----------------------------------------------------------------------
  delete from public.workouts where id = w_push;

  if not exists (select 1 from public.sessions where id = s_flat) then
    failures := array_append(failures, 'deleting a library workout deleted the session');
  end if;
  if (select source_workout_id from public.sessions where id = s_flat) is not null then
    failures := array_append(failures, 'source_workout_id was not nulled on library delete');
  end if;
  select count(*) into v_count from public.session_exercises where session_id = s_flat;
  if v_count <> 2 then
    failures := array_append(failures,
      format('the session lost exercises when its library workout went: %s left', v_count));
  end if;

  -- -----------------------------------------------------------------------
  -- 6. Cascades: a phase takes its sessions and their exercises with it
  -- -----------------------------------------------------------------------
  insert into public.session_exercises (session_id, section, exercise_id, sort_order)
  values (s_phased, 'main', ex_bench, 0);

  delete from public.program_phases where id = phase_one;

  if exists (select 1 from public.sessions where id = s_phased) then
    failures := array_append(failures, 'deleting a phase left its sessions behind');
  end if;
  if exists (select 1 from public.session_exercises where session_id = s_phased) then
    failures := array_append(failures, 'deleting a phase left orphaned session_exercises');
  end if;

  -- -----------------------------------------------------------------------
  -- 7. RLS: another coach sees nothing and can write nothing
  -- -----------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', coach_two)::text, true);

  select count(*) into v_count from public.sessions;
  if v_count <> 0 then
    failures := array_append(failures,
      format('another coach can read %s sessions', v_count));
  end if;

  select count(*) into v_count from public.session_exercises;
  if v_count <> 0 then
    failures := array_append(failures,
      format('another coach can read %s session_exercises', v_count));
  end if;

  update public.sessions set name = 'Hijacked' where id = s_flat;
  if exists (select 1 from public.sessions where id = s_flat and name = 'Hijacked') then
    failures := array_append(failures, 'another coach updated a session');
  end if;

  -- -----------------------------------------------------------------------
  -- 8. RLS: the assigned client reads their sessions; the other client cannot
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);

  if not exists (select 1 from public.sessions where id = s_flat) then
    failures := array_append(failures, 'the assigned client cannot read their own session');
  end if;
  select count(*) into v_count from public.session_exercises where session_id = s_flat;
  if v_count <> 2 then
    failures := array_append(failures,
      format('the assigned client sees %s of their 2 session exercises', v_count));
  end if;

  -- A client never writes a session: there is only a SELECT policy, so this
  -- is refused outright rather than silently matching zero rows.
  begin
    update public.sessions set name = 'Client edit' where id = s_flat;
    if exists (select 1 from public.sessions where id = s_flat and name = 'Client edit') then
      failures := array_append(failures, 'a client updated their own session');
    end if;
  exception when insufficient_privilege then
    null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', client_b)::text, true);

  select count(*) into v_count from public.sessions;
  if v_count <> 0 then
    failures := array_append(failures,
      format('an unassigned client of the same coach can read %s sessions', v_count));
  end if;

  perform set_config('role', 'postgres', true);

  -- -----------------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise notice 'PASSED: sessions schema and policies';
  else
    raise exception E'FAILED:\n  %', array_to_string(failures, E'\n  ');
  end if;
end;
$$;

rollback;
