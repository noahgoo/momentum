-- Assertions for Phase 3 program isolation (migration 0020).
--
-- Same rollback-safe shape as the other suites: one transaction, one DO
-- block accumulating failures, always raising PASSED/FAILED at the end.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0020_program_isolation_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id  uuid := 'aa000000-0000-0000-0000-000000000001';
  coach_two uuid := 'aa000000-0000-0000-0000-000000000002';
  client_a  uuid := 'aa000000-0000-0000-0000-00000000000a';
  client_b  uuid := 'aa000000-0000-0000-0000-00000000000b';

  tmpl_program uuid := 'cc000000-0000-0000-0000-000000000001';
  w_push       uuid := 'bb000000-0000-0000-0000-000000000001';
  w_warm       uuid := 'bb000000-0000-0000-0000-000000000002';
  ex_bench     uuid := 'ee000000-0000-0000-0000-000000000001';

  v_start date := date_trunc('week', current_date)::date;

  v_assign_a uuid;
  v_assign_b uuid;
  v_prog_a uuid;
  v_prog_b uuid;
  v_count int;
  v_text text;
  v_uuid uuid;
  v_num numeric;
begin
  -- -----------------------------------------------------------------------
  -- Fixtures: one template program, phased, with a workout that has a warmup
  -- -----------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'iso-coach@test.local', jsonb_build_object('role','coach','display_name','Iso Coach')),
    (coach_two, 'iso-coach2@test.local', jsonb_build_object('role','coach','display_name','Other Coach')),
    (client_a, 'iso-a@test.local',
      jsonb_build_object('role','client','display_name','Iso A','invited_by',coach_id::text)),
    (client_b, 'iso-b@test.local',
      jsonb_build_object('role','client','display_name','Iso B','invited_by',coach_id::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_bench, 'Bench', coach_id);
  insert into public.workouts (id, name, type, created_by) values (w_warm, 'Warmup A', 'warmup', coach_id);
  insert into public.workouts (id, name, type, warmup_id, created_by)
  values (w_push, 'Push Day', 'workout', w_warm, coach_id);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_push, ex_bench, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);

  insert into public.programs (id, name, weeks, created_by) values (tmpl_program, 'Template Program', 2, coach_id);
  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id)
  values (tmpl_program, 1, 'monday', w_push);

  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);

  -- -----------------------------------------------------------------------
  -- assign_program deep-copies (B1)
  -- -----------------------------------------------------------------------
  v_assign_a := public.assign_program(client_a, tmpl_program, v_start);
  v_assign_b := public.assign_program(client_b, tmpl_program, v_start);

  select program_id into v_prog_a from public.assignments where id = v_assign_a;
  select program_id into v_prog_b from public.assignments where id = v_assign_b;

  if v_prog_a = tmpl_program or v_prog_b = tmpl_program then
    failures := array_append(failures, 'assignment still points at the TEMPLATE program (B1 not fixed)');
  end if;
  if v_prog_a = v_prog_b then
    failures := array_append(failures, 'both clients were given the SAME program row');
  end if;

  select client_id into v_uuid from public.programs where id = v_prog_a;
  if v_uuid is distinct from client_a then
    failures := array_append(failures, 'instance program is not stamped with client_id');
  end if;

  -- The instance's schedule must point at the instance's OWN workouts.
  select count(*) into v_count
  from public.week_schedules ws
  join public.workouts w on w.id = ws.workout_id
  where ws.program_id = v_prog_a and w.client_id is distinct from client_a;
  if v_count <> 0 then
    failures := array_append(failures, 'client A''s schedule references workouts that are not theirs');
  end if;

  -- Warmups are copied too, and re-linked to the copy rather than the template.
  select w.warmup_id into v_uuid
  from public.week_schedules ws join public.workouts w on w.id = ws.workout_id
  where ws.program_id = v_prog_a;
  if v_uuid is null then
    failures := array_append(failures, 'copied workout lost its warmup link');
  elsif v_uuid = w_warm then
    failures := array_append(failures, 'copied workout still points at the TEMPLATE warmup');
  else
    select client_id into v_uuid from public.workouts where id = v_uuid;
    if v_uuid is distinct from client_a then
      failures := array_append(failures, 'copied warmup is not stamped with client_id');
    end if;
  end if;

  -- workout_exercises come along, still FKing the shared exercise library.
  select count(*) into v_count
  from public.workout_exercises we
  join public.week_schedules ws on ws.workout_id = we.workout_id
  where ws.program_id = v_prog_a and we.exercise_id = ex_bench;
  if v_count <> 1 then
    failures := array_append(failures, format('expected the copied workout to keep its exercise, got %s', v_count));
  end if;

  -- -----------------------------------------------------------------------
  -- Editing the template reaches nobody (B2) — the whole point
  -- -----------------------------------------------------------------------
  update public.workout_exercises
  set set_configs = '[{"reps":99,"weight":999,"weight_unit":"lbs"}]'::jsonb
  where workout_id = w_push;
  update public.programs set name = 'Template Renamed' where id = tmpl_program;

  select (we.set_configs->0->>'weight')::numeric into v_num
  from public.workout_exercises we
  join public.week_schedules ws on ws.workout_id = we.workout_id
  where ws.program_id = v_prog_a;
  if v_num is distinct from 135 then
    failures := array_append(failures,
      format('editing the template changed client A''s live program (B2): weight is now %s', v_num));
  end if;

  select name into v_text from public.programs where id = v_prog_a;
  if v_text = 'Template Renamed' then
    failures := array_append(failures, 'renaming the template renamed the client''s copy');
  end if;

  -- -----------------------------------------------------------------------
  -- Editing ONE client's copy reaches only them (tier 2)
  -- -----------------------------------------------------------------------
  update public.workout_exercises we
  set set_configs = '[{"reps":3,"weight":225,"weight_unit":"lbs"}]'::jsonb
  from public.week_schedules ws
  where ws.workout_id = we.workout_id and ws.program_id = v_prog_a;

  select (we.set_configs->0->>'weight')::numeric into v_num
  from public.workout_exercises we
  join public.week_schedules ws on ws.workout_id = we.workout_id
  where ws.program_id = v_prog_b;
  if v_num is distinct from 135 then
    failures := array_append(failures,
      format('editing client A''s program changed client B''s: B now reads %s', v_num));
  end if;

  -- -----------------------------------------------------------------------
  -- Exactly one active assignment, never zero (B8)
  -- -----------------------------------------------------------------------
  perform public.assign_program(client_a, tmpl_program, v_start);
  select count(*) into v_count from public.assignments where client_id = client_a and active;
  if v_count <> 1 then
    failures := array_append(failures, format('expected exactly 1 active assignment, got %s', v_count));
  end if;
  select count(*) into v_count from public.assignments where client_id = client_a;
  if v_count <> 2 then
    failures := array_append(failures, format('reassigning should keep the old assignment row, got %s total', v_count));
  end if;

  -- -----------------------------------------------------------------------
  -- Guards
  -- -----------------------------------------------------------------------
  begin
    perform public.assign_program(client_a, v_prog_b, v_start);
    failures := array_append(failures, 'assigning an INSTANCE program should raise not_a_template');
  exception when others then
    if sqlerrm <> 'not_a_template' then
      failures := array_append(failures, format('expected not_a_template, got: %s', sqlerrm));
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', coach_two)::text, true);
  begin
    perform public.assign_program(client_a, tmpl_program, v_start);
    failures := array_append(failures, 'assigning to another coach''s client should raise not_your_client');
  exception when others then
    if sqlerrm <> 'not_your_client' then
      failures := array_append(failures, format('expected not_your_client, got: %s', sqlerrm));
    end if;
  end;

  -- -----------------------------------------------------------------------
  -- duplicate_program (library copy stays a template)
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);
  v_uuid := public.duplicate_program(tmpl_program);

  select client_id into v_prog_a from public.programs where id = v_uuid;
  if v_prog_a is not null then
    failures := array_append(failures, 'duplicating a template produced a client-stamped program');
  end if;
  select name into v_text from public.programs where id = v_uuid;
  if v_text not like '% (copy)' then
    failures := array_append(failures, format('duplicate should be suffixed " (copy)", got %s', v_text));
  end if;

  -- -----------------------------------------------------------------------
  -- Delete blockers speak in domain terms (B4)
  -- -----------------------------------------------------------------------
  select public.program_delete_blockers(tmpl_program) into v_count;
  if v_count <> 0 then
    failures := array_append(failures,
      format('a template should have 0 assignment blockers (assignments point at instances), got %s', v_count));
  end if;

  select program_id into v_uuid from public.assignments where id = v_assign_b;
  select public.program_delete_blockers(v_uuid) into v_count;
  if v_count <> 1 then
    failures := array_append(failures, format('client B''s instance should report 1 blocker, got %s', v_count));
  end if;

  -- restrict actually bites rather than cascading a client's program away.
  begin
    delete from public.programs where id = v_uuid;
    failures := array_append(failures, 'deleting an assigned instance program should be restricted');
  exception when foreign_key_violation then
    null; -- expected
  end;

  -- -----------------------------------------------------------------------
  -- save_workout reconciles instead of churning ids (B3) and detects
  -- concurrent edits (C-3)
  -- -----------------------------------------------------------------------
  declare
    v_ex_id_before uuid;
    v_ex_id_after uuid;
    v_updated timestamptz;
  begin
    select id into v_ex_id_before
    from public.workout_exercises where workout_id = w_push and sort_order = 0;

    perform public.save_workout(
      p_workout_id => w_push,
      p_payload => jsonb_build_object(
        'name', 'Push Day',
        'type', 'workout',
        'exercises', jsonb_build_array(
          jsonb_build_object('exercise_id', ex_bench::text, 'mode', 'reps',
            'set_configs', '[{"reps":8,"weight":155,"weight_unit":"lbs"}]'::jsonb)
        )
      ),
      p_expected_updated_at => null
    );

    select id into v_ex_id_after
    from public.workout_exercises where workout_id = w_push and sort_order = 0;

    if v_ex_id_after is distinct from v_ex_id_before then
      failures := array_append(failures,
        'save_workout churned the exercise row id instead of updating in place (B3)');
    end if;

    select (set_configs->0->>'weight')::numeric into v_num
    from public.workout_exercises where workout_id = w_push and sort_order = 0;
    if v_num is distinct from 155 then
      failures := array_append(failures, format('save_workout did not apply the new target, got %s', v_num));
    end if;

    -- Adding then removing a row leaves the surviving row's id intact.
    perform public.save_workout(
      p_workout_id => w_push,
      p_payload => jsonb_build_object('name','Push Day','type','workout','exercises', jsonb_build_array(
        jsonb_build_object('exercise_id', ex_bench::text, 'mode','reps','set_configs','[]'::jsonb),
        jsonb_build_object('exercise_id', ex_bench::text, 'mode','reps','set_configs','[]'::jsonb)
      )));
    select count(*) into v_count from public.workout_exercises where workout_id = w_push;
    if v_count <> 2 then
      failures := array_append(failures, format('expected 2 exercises after adding one, got %s', v_count));
    end if;

    perform public.save_workout(
      p_workout_id => w_push,
      p_payload => jsonb_build_object('name','Push Day','type','workout','exercises', jsonb_build_array(
        jsonb_build_object('exercise_id', ex_bench::text, 'mode','reps','set_configs','[]'::jsonb)
      )));
    select count(*) into v_count from public.workout_exercises where workout_id = w_push;
    if v_count <> 1 then
      failures := array_append(failures, format('expected 1 exercise after removing one, got %s', v_count));
    end if;

    select id into v_ex_id_after
    from public.workout_exercises where workout_id = w_push and sort_order = 0;
    if v_ex_id_after is distinct from v_ex_id_before then
      failures := array_append(failures, 'the surviving exercise row lost its id across add/remove');
    end if;

    -- A save carrying a stale updated_at must be refused, not silently win.
    select updated_at into v_updated from public.workouts where id = w_push;
    begin
      perform public.save_workout(
        p_workout_id => w_push,
        p_payload => jsonb_build_object('name','Clobbered','type','workout','exercises','[]'::jsonb),
        p_expected_updated_at => v_updated - interval '1 hour'
      );
      failures := array_append(failures, 'a stale save should raise stale_write (C-3)');
    exception when others then
      if sqlerrm <> 'stale_write' then
        failures := array_append(failures, format('expected stale_write, got: %s', sqlerrm));
      end if;
    end;

    -- The matching updated_at goes through.
    perform public.save_workout(
      p_workout_id => w_push,
      p_payload => jsonb_build_object('name','Push Day v2','type','workout','exercises','[]'::jsonb),
      p_expected_updated_at => v_updated
    );
    select name into v_text from public.workouts where id = w_push;
    if v_text <> 'Push Day v2' then
      failures := array_append(failures, 'a save with the current updated_at should succeed');
    end if;
  end;

  -- -----------------------------------------------------------------------
  -- save_program reconciles phases and slots instead of churning ids (B3)
  -- and detects concurrent edits (C-3)
  -- -----------------------------------------------------------------------
  declare
    v_prog uuid;
    v_phase_id_before uuid;
    v_phase_id_after uuid;
    v_slot_id_before uuid;
    v_slot_id_after uuid;
    v_updated timestamptz;
  begin
    v_prog := public.save_program(
      p_payload => jsonb_build_object(
        'name', 'Phased Program', 'description', '', 'weeks', 4, 'phased', true,
        'phases', jsonb_build_array(
          jsonb_build_object('name','Base','weeks',2,'active_days', jsonb_build_array('monday')),
          jsonb_build_object('name','Peak','weeks',2,'active_days', jsonb_build_array('monday'))
        ),
        'slots', jsonb_build_array(
          jsonb_build_object('phase_index',0,'week_number',1,'day_of_week','monday','workout_id',w_push::text),
          jsonb_build_object('phase_index',1,'week_number',1,'day_of_week','monday','workout_id',w_push::text)
        )
      )
    );

    select count(*) into v_count from public.program_phases where program_id = v_prog;
    if v_count <> 2 then
      failures := array_append(failures, format('expected 2 phases, got %s', v_count));
    end if;

    select count(*) into v_count
    from public.week_schedules ws join public.program_phases ph on ph.id = ws.phase_id
    where ph.program_id = v_prog;
    if v_count <> 2 then
      failures := array_append(failures, format('expected 2 phase-scoped slots, got %s', v_count));
    end if;

    select id into v_phase_id_before from public.program_phases
    where program_id = v_prog and sort_order = 0;
    select ws.id into v_slot_id_before
    from public.week_schedules ws join public.program_phases ph on ph.id = ws.phase_id
    where ph.program_id = v_prog and ph.sort_order = 0;

    -- Rename a phase and repoint a slot: ids must survive.
    perform public.save_program(
      p_payload => jsonb_build_object(
        'name', 'Phased Program', 'description', '', 'weeks', 4, 'phased', true,
        'phases', jsonb_build_array(
          jsonb_build_object('name','Base Renamed','weeks',2,'active_days', jsonb_build_array('monday')),
          jsonb_build_object('name','Peak','weeks',2,'active_days', jsonb_build_array('monday'))
        ),
        'slots', jsonb_build_array(
          jsonb_build_object('phase_index',0,'week_number',1,'day_of_week','monday','workout_id',w_push::text),
          jsonb_build_object('phase_index',1,'week_number',1,'day_of_week','monday','workout_id',w_push::text)
        )
      ),
      p_program_id => v_prog
    );

    select id into v_phase_id_after from public.program_phases
    where program_id = v_prog and sort_order = 0;
    if v_phase_id_after is distinct from v_phase_id_before then
      failures := array_append(failures, 'save_program churned the phase id instead of updating in place (B3)');
    end if;

    select ws.id into v_slot_id_after
    from public.week_schedules ws join public.program_phases ph on ph.id = ws.phase_id
    where ph.program_id = v_prog and ph.sort_order = 0;
    if v_slot_id_after is distinct from v_slot_id_before then
      failures := array_append(failures, 'save_program churned the schedule slot id (B3)');
    end if;

    select name into v_text from public.program_phases where id = v_phase_id_after;
    if v_text <> 'Base Renamed' then
      failures := array_append(failures, 'save_program did not apply the phase rename');
    end if;

    -- Dropping a phase removes it and its slots, leaving the survivor intact.
    perform public.save_program(
      p_payload => jsonb_build_object(
        'name','Phased Program','description','','weeks',2,'phased', true,
        'phases', jsonb_build_array(
          jsonb_build_object('name','Base Renamed','weeks',2,'active_days', jsonb_build_array('monday'))
        ),
        'slots', jsonb_build_array(
          jsonb_build_object('phase_index',0,'week_number',1,'day_of_week','monday','workout_id',w_push::text)
        )
      ),
      p_program_id => v_prog
    );

    select count(*) into v_count from public.program_phases where program_id = v_prog;
    if v_count <> 1 then
      failures := array_append(failures, format('expected 1 phase after dropping one, got %s', v_count));
    end if;
    select id into v_phase_id_after from public.program_phases where program_id = v_prog and sort_order = 0;
    if v_phase_id_after is distinct from v_phase_id_before then
      failures := array_append(failures, 'the surviving phase lost its id when a later phase was dropped');
    end if;

    -- Removing a slot from the payload deletes just that slot.
    perform public.save_program(
      p_payload => jsonb_build_object(
        'name','Phased Program','description','','weeks',2,'phased', true,
        'phases', jsonb_build_array(
          jsonb_build_object('name','Base Renamed','weeks',2,'active_days', jsonb_build_array('monday'))
        ),
        'slots', '[]'::jsonb
      ),
      p_program_id => v_prog
    );
    select count(*) into v_count
    from public.week_schedules ws join public.program_phases ph on ph.id = ws.phase_id
    where ph.program_id = v_prog;
    if v_count <> 0 then
      failures := array_append(failures, format('removing every slot should clear them, got %s', v_count));
    end if;

    -- Switching phased -> flat clears the phase scope and writes program-scoped rows.
    perform public.save_program(
      p_payload => jsonb_build_object(
        'name','Now Flat','description','','weeks',2,'phased', false,
        'phases','[]'::jsonb,
        'slots', jsonb_build_array(
          jsonb_build_object('week_number',1,'day_of_week','monday','workout_id',w_push::text)
        )
      ),
      p_program_id => v_prog
    );
    select count(*) into v_count from public.program_phases where program_id = v_prog;
    if v_count <> 0 then
      failures := array_append(failures, format('switching to flat should drop phases, got %s', v_count));
    end if;
    select count(*) into v_count from public.week_schedules where program_id = v_prog;
    if v_count <> 1 then
      failures := array_append(failures, format('expected 1 flat slot, got %s', v_count));
    end if;

    -- Stale write refused.
    select updated_at into v_updated from public.programs where id = v_prog;
    begin
      perform public.save_program(
        p_payload => jsonb_build_object('name','Clobbered','description','','weeks',2,
          'phased', false, 'phases','[]'::jsonb, 'slots','[]'::jsonb),
        p_program_id => v_prog,
        p_expected_updated_at => v_updated - interval '1 hour'
      );
      failures := array_append(failures, 'a stale program save should raise stale_write (C-3)');
    exception when others then
      if sqlerrm <> 'stale_write' then
        failures := array_append(failures, format('expected stale_write, got: %s', sqlerrm));
      end if;
    end;
  end;

  -- -----------------------------------------------------------------------
  -- Ownership: SECURITY DEFINER bypasses RLS, so each save/read RPC must
  -- check the caller owns the row. Without this, any authenticated coach
  -- could rewrite another coach's workout or program by guessing an id.
  -- -----------------------------------------------------------------------
  declare
    v_other_prog uuid;
  begin
    -- coach_two owns nothing here; every call below targets coach_id's rows.
    perform set_config('request.jwt.claims', json_build_object('sub', coach_two)::text, true);

    begin
      perform public.save_workout(
        p_workout_id => w_push,
        p_payload => jsonb_build_object('name','Hijacked','type','workout','exercises','[]'::jsonb)
      );
      failures := array_append(failures,
        'save_workout let a coach edit another coach''s workout (IDOR)');
    exception when others then
      if sqlerrm <> 'not_found_or_forbidden' then
        failures := array_append(failures, format('expected not_found_or_forbidden, got: %s', sqlerrm));
      end if;
    end;

    select name into v_text from public.workouts where id = w_push;
    if v_text = 'Hijacked' then
      failures := array_append(failures, 'another coach''s workout was actually renamed');
    end if;

    begin
      perform public.save_program(
        p_payload => jsonb_build_object('name','Hijacked','description','','weeks',1,
          'phased', false, 'phases','[]'::jsonb, 'slots','[]'::jsonb),
        p_program_id => tmpl_program
      );
      failures := array_append(failures,
        'save_program let a coach edit another coach''s program (IDOR)');
    exception when others then
      if sqlerrm <> 'not_found_or_forbidden' then
        failures := array_append(failures, format('expected not_found_or_forbidden, got: %s', sqlerrm));
      end if;
    end;

    select name into v_text from public.programs where id = tmpl_program;
    if v_text = 'Hijacked' then
      failures := array_append(failures, 'another coach''s program was actually renamed');
    end if;

    begin
      perform public.duplicate_program(tmpl_program);
      failures := array_append(failures,
        'duplicate_program let a coach copy another coach''s program');
    exception when others then
      if sqlerrm <> 'not_found_or_forbidden' then
        failures := array_append(failures, format('expected not_found_or_forbidden, got: %s', sqlerrm));
      end if;
    end;

    -- The blocker counts must not report on rows the caller does not own.
    select public.program_delete_blockers(tmpl_program) into v_count;
    if v_count <> 0 then
      failures := array_append(failures,
        format('program_delete_blockers leaked another coach''s count: %s', v_count));
    end if;
    select public.workout_delete_blockers(w_push) into v_count;
    if v_count <> 0 then
      failures := array_append(failures,
        format('workout_delete_blockers leaked another coach''s count: %s', v_count));
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);
  end;

  raise exception 'PROGRAM_ISOLATION_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
