-- Assertions for the instance-program save guard (migration 0030).
--
-- Same rollback-safe shape as the other suites: one transaction, one DO
-- block accumulating failures, always raising PASSED/FAILED at the end.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0030_instance_program_guard_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id uuid := 'ad000000-0000-0000-0000-000000000001';
  client_a uuid := 'ad000000-0000-0000-0000-00000000000a';

  tmpl_program uuid := 'cd000000-0000-0000-0000-000000000001';
  w_push       uuid := 'bd000000-0000-0000-0000-000000000001';
  ex_bench     uuid := 'ed000000-0000-0000-0000-000000000001';

  v_start date := date_trunc('week', current_date)::date;

  v_assignment uuid;
  v_instance_program uuid;
  v_payload jsonb;
  v_before int;
  v_after int;
  v_raised text;
begin
  -- -----------------------------------------------------------------------
  -- Fixtures: a template with one scheduled day, assigned to one client
  -- -----------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'guard-coach@test.local',
      jsonb_build_object('role','coach','display_name','Guard Coach')),
    (client_a, 'guard-a@test.local',
      jsonb_build_object('role','client','display_name','Guard A','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_bench, 'Bench', coach_id);
  insert into public.workouts (id, name, type, created_by)
  values (w_push, 'Push Day', 'workout', coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_push, ex_bench, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by)
  values (tmpl_program, 'Guard Template', 2, coach_id);
  -- Nothing writes week_schedules any more (0034); a slot is a session.
  perform public.materialize_session(tmpl_program, null, 1, 'monday', w_push);

  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);

  -- Two steps: calling assign_program inside the WHERE evaluates the clause
  -- against a snapshot taken before the function's insert, so the row is never
  -- found.
  v_assignment := public.assign_program(client_a, tmpl_program, v_start);
  select program_id into v_instance_program
  from public.assignments where id = v_assignment;

  -- The payload the library builder produces for a program whose every day
  -- select rendered blank: the program's own fields, and no slots at all.
  v_payload := jsonb_build_object(
    'name', 'Guard Template', 'description', null, 'weeks', 2,
    'phased', false, 'phases', '[]'::jsonb, 'slots', '[]'::jsonb
  );

  -- -----------------------------------------------------------------------
  -- 1. save_program refuses a client's own copy
  -- -----------------------------------------------------------------------
  select count(*) into v_before
  from public.sessions s
  where s.program_id = v_instance_program;

  if v_before = 0 then
    failures := array_append(failures, 'fixture: the instance program has no scheduled days to protect');
  end if;

  begin
    perform public.save_program(v_payload, v_instance_program, null);
    failures := array_append(failures, 'save_program accepted a program with client_id set');
  exception when others then
    v_raised := sqlerrm;
    if v_raised <> 'not_a_template' then
      failures := array_append(failures, format('save_program raised %L, expected not_a_template', v_raised));
    end if;
  end;

  -- -----------------------------------------------------------------------
  -- 2. The refusal left the client's schedule untouched
  -- -----------------------------------------------------------------------
  select count(*) into v_after
  from public.sessions s
  where s.program_id = v_instance_program;

  if v_after <> v_before then
    failures := array_append(failures, format(
      'the refused save changed the client''s schedule: %s slots before, %s after',
      v_before, v_after
    ));
  end if;

  -- -----------------------------------------------------------------------
  -- 3. A library template still saves — the guard is not a blanket refusal
  -- -----------------------------------------------------------------------
  begin
    perform public.save_program(
      v_payload || jsonb_build_object('name', 'Guard Template Renamed'),
      tmpl_program,
      null
    );
  exception when others then
    failures := array_append(failures, format('save_program refused a library template: %L', sqlerrm));
  end;

  if not exists (
    select 1 from public.programs
    where id = tmpl_program and name = 'Guard Template Renamed'
  ) then
    failures := array_append(failures, 'the template save did not land');
  end if;

  -- -----------------------------------------------------------------------
  -- 4. That payload really is destructive — which is what the guard is for
  --
  -- The template just took the same slotless payload the blank builder
  -- produces. If its scheduled day survived, save_program does not actually
  -- delete omitted slots, and assertions 1-2 would be guarding nothing.
  -- -----------------------------------------------------------------------
  select count(*) into v_after
  from public.sessions s
  where s.program_id = tmpl_program;

  if v_after <> 0 then
    failures := array_append(failures, format(
      'a slotless payload left %s slots on the template, so this suite proves nothing',
      v_after
    ));
  end if;

  -- -----------------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise notice 'PASSED: instance-program save guard';
  else
    raise exception E'FAILED:\n  %', array_to_string(failures, E'\n  ');
  end if;
end;
$$;

rollback;
