-- Phase 3 of the ruleset remediation (docs/rules/violations.md B1, B2, B3,
-- B4, B8).
--
-- Assigning a program linked the coach's TEMPLATE row directly
-- (assignments.program_id -> the library program). Every client on
-- "Hypertrophy 8wk" shared one set of rows, so editing the template
-- reshuffled the live schedule of every client already mid-program, and
-- there was no way to change one client's Tuesday without changing
-- everyone's (B1, B2).
--
-- Assign now deep-copies the program tree into client_id-stamped instance
-- rows, so a client's program is structurally independent from the moment it
-- is assigned. `programs.client_id`/`workouts.client_id` already existed for
-- exactly this and were never written by anything.
--
-- The builder saves also stop deleting and reinserting their children, which
-- churned primary keys on every save (B3), and gain optimistic-concurrency
-- checks so two coaches editing one program cannot silently lose an edit.
--
-- See docs/rules/data-model.md — the tier model, R1, R2, R3, R4.

-- ---------------------------------------------------------------------------
-- copy_program_tree: internal deep copy (no auth checks)
-- ---------------------------------------------------------------------------

create function public.copy_program_tree(
  p_program_id uuid,
  p_client_id uuid,
  p_name_suffix text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.programs%rowtype;
  v_new_program_id uuid;
begin
  select * into v_source from public.programs where id = p_program_id;
  if v_source.id is null then
    raise exception 'program_not_found';
  end if;

  insert into public.programs (name, description, weeks, created_by, client_id)
  values (
    v_source.name || coalesce(p_name_suffix, ''),
    v_source.description,
    v_source.weeks,
    v_source.created_by,
    p_client_id
  )
  returning id into v_new_program_id;

  -- Phases, keeping a map from old id to new so week_schedules can be remapped.
  create temp table if not exists _phase_map (old_id uuid, new_id uuid) on commit drop;
  delete from _phase_map;

  with inserted as (
    insert into public.program_phases (program_id, name, sort_order, weeks, active_days)
    select v_new_program_id, ph.name, ph.sort_order, ph.weeks, ph.active_days
    from public.program_phases ph
    where ph.program_id = p_program_id
    returning id, sort_order
  )
  insert into _phase_map (old_id, new_id)
  select ph.id, i.id
  from public.program_phases ph
  join inserted i on i.sort_order = ph.sort_order
  where ph.program_id = p_program_id;

  -- Workouts referenced by this program's schedule, plus any warmups they
  -- link to. Copied per client so editing one client's workout touches only
  -- them. `exercises` is reference data (name, video, defaults) and is NOT
  -- copied — instance workout_exercises keep FKing into the shared library.
  create temp table if not exists _workout_map (old_id uuid, new_id uuid) on commit drop;
  delete from _workout_map;

  -- INSERT ... RETURNING cannot return the source row's id alongside the new
  -- one, and matching them back up by name would collide whenever a coach has
  -- two workouts with the same name. Insert one at a time instead: these are
  -- a handful of rows per program, and correctness beats a single round trip.
  declare
    v_workout record;
    v_new_workout_id uuid;
  begin
    for v_workout in
      with referenced as (
        select distinct ws.workout_id as id
        from public.week_schedules ws
        left join public.program_phases ph on ph.id = ws.phase_id
        where (ws.program_id = p_program_id or ph.program_id = p_program_id)
          and ws.workout_id is not null
      ),
      -- A warmup is reachable only through the workout that links it, so pull
      -- those in too or the copy would point back at a template warmup.
      with_warmups as (
        select id from referenced
        union
        select w.warmup_id
        from public.workouts w
        join referenced r on r.id = w.id
        where w.warmup_id is not null
      )
      select w.* from public.workouts w join with_warmups ww on ww.id = w.id
    loop
      insert into public.workouts (
        name, description, estimated_duration_minutes, equipment, type, created_by, client_id
      )
      values (
        v_workout.name, v_workout.description, v_workout.estimated_duration_minutes,
        v_workout.equipment, v_workout.type, v_workout.created_by, p_client_id
      )
      returning id into v_new_workout_id;

      insert into _workout_map (old_id, new_id) values (v_workout.id, v_new_workout_id);
    end loop;
  end;

  -- Re-link each copied workout's warmup to the copied warmup.
  update public.workouts tgt
  set warmup_id = wm_warm.new_id
  from _workout_map wm_src
  join public.workouts src on src.id = wm_src.old_id
  join _workout_map wm_warm on wm_warm.old_id = src.warmup_id
  where tgt.id = wm_src.new_id and src.warmup_id is not null;

  insert into public.workout_exercises (
    workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select m.new_id, we.exercise_id, we.sort_order, we.mode, we.set_configs,
         we.rest_seconds, we.notes
  from public.workout_exercises we
  join _workout_map m on m.old_id = we.workout_id;

  -- Schedules last: they reference both the new phases and the new workouts.
  insert into public.week_schedules (program_id, phase_id, week_number, day_of_week, workout_id)
  select
    case when ws.program_id is not null then v_new_program_id else null end,
    pm.new_id,
    ws.week_number,
    ws.day_of_week,
    wm.new_id
  from public.week_schedules ws
  left join public.program_phases ph on ph.id = ws.phase_id
  left join _phase_map pm on pm.old_id = ws.phase_id
  left join _workout_map wm on wm.old_id = ws.workout_id
  where ws.program_id = p_program_id or ph.program_id = p_program_id;

  return v_new_program_id;
end;
$$;

comment on function public.copy_program_tree(uuid, uuid, text) is
  'Internal: deep-copies a program (phases, week_schedules, the workouts those schedules reference, their linked warmups, and workout_exercises) stamping programs.client_id/workouts.client_id with p_client_id — NULL for a library duplicate. `exercises` is shared reference data and is not copied. No auth checks: call only from assign_program/duplicate_program, or as postgres in tests.';

revoke execute on function public.copy_program_tree(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- assign_program: deep copy + deactivate + activate, atomically (B1, B2, B8)
-- ---------------------------------------------------------------------------

create function public.assign_program(
  p_client_id uuid,
  p_program_id uuid,
  p_start_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.programs%rowtype;
  v_instance_id uuid;
  v_assignment_id uuid;
begin
  if not public.is_coach_of(p_client_id) then
    raise exception 'not_your_client';
  end if;

  select * into v_source from public.programs where id = p_program_id;
  if v_source.id is null then
    raise exception 'program_not_found';
  end if;

  -- Only a library template may be assigned. Assigning an instance would
  -- hand two clients the same rows again — the bug this function exists to
  -- prevent.
  if v_source.client_id is not null then
    raise exception 'not_a_template';
  end if;

  v_instance_id := public.copy_program_tree(p_program_id, p_client_id, null);

  -- Both halves in one transaction: the old code did these as separate
  -- requests, leaving a window with no active assignment, and retried on the
  -- resulting unique violation (B8).
  update public.assignments set active = false
  where client_id = p_client_id and active;

  insert into public.assignments (client_id, program_id, start_date, active)
  values (p_client_id, v_instance_id, p_start_date, true)
  returning id into v_assignment_id;

  return v_assignment_id;
end;
$$;

comment on function public.assign_program(uuid, uuid, date) is
  'RPC: assigns a library program to a client by DEEP-COPYING it into client-owned instance rows, then deactivating any prior assignment and inserting the new one — all in one transaction. The client''s program is independent from assignment: editing the template afterwards never reaches them. Raises: not_your_client, program_not_found, not_a_template.';

revoke execute on function public.assign_program(uuid, uuid, date) from public, anon;
grant execute on function public.assign_program(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- duplicate_program: library-to-library copy, replacing the client-side one
-- ---------------------------------------------------------------------------

create function public.duplicate_program(p_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.programs%rowtype;
begin
  select * into v_source from public.programs where id = p_program_id;
  if v_source.id is null then
    raise exception 'program_not_found';
  end if;
  if v_source.created_by is distinct from auth.uid() then
    raise exception 'not_found_or_forbidden';
  end if;

  return public.copy_program_tree(p_program_id, v_source.client_id, ' (copy)');
end;
$$;

comment on function public.duplicate_program(uuid) is
  'RPC: duplicates one of the calling coach''s programs, name suffixed " (copy)". Shares copy_program_tree with assign_program rather than reimplementing the tree walk client-side, so the two can never diverge. Raises: program_not_found, not_found_or_forbidden.';

revoke execute on function public.duplicate_program(uuid) from public, anon;
grant execute on function public.duplicate_program(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Explicit FK delete behavior (B4, docs/rules/data-model.md R4)
-- ---------------------------------------------------------------------------
-- A bare `references` is NO ACTION, which fails a delete late and opaquely
-- with a raw 23503. Each of these now states what it means:
--   restrict  -> deleting this would strand a client
--   set null  -> a provenance pointer history keeps but does not depend on

alter table public.assignments
  drop constraint assignments_program_id_fkey,
  add constraint assignments_program_id_fkey
    foreign key (program_id) references public.programs (id) on delete restrict;

alter table public.week_schedules
  drop constraint week_schedules_workout_id_fkey,
  add constraint week_schedules_workout_id_fkey
    foreign key (workout_id) references public.workouts (id) on delete restrict;

alter table public.exercise_logs
  drop constraint exercise_logs_exercise_id_fkey,
  add constraint exercise_logs_exercise_id_fkey
    foreign key (exercise_id) references public.exercises (id) on delete set null;

-- ---------------------------------------------------------------------------
-- program_delete_blockers: domain-language answer to "can I delete this?"
-- ---------------------------------------------------------------------------

create function public.program_delete_blockers(p_program_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Scoped to the caller's own programs: SECURITY DEFINER bypasses RLS, and
  -- an unscoped count would confirm the existence of, and report activity on,
  -- another coach's program by id.
  select count(*)::int
  from public.assignments a
  join public.programs p on p.id = a.program_id
  where a.program_id = p_program_id
    and p.created_by = auth.uid();
$$;

comment on function public.program_delete_blockers(uuid) is
  'RPC: how many assignments reference this program. Lets the coach UI say "3 clients are on this program" instead of surfacing a raw foreign-key error (R4). Always 0 for a true library template, since assignments point at instances.';

revoke execute on function public.program_delete_blockers(uuid) from public, anon;
grant execute on function public.program_delete_blockers(uuid) to authenticated;

create function public.workout_delete_blockers(p_workout_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Scoped to the caller's own workouts, for the same reason.
  select count(*)::int
  from public.week_schedules ws
  join public.workouts w on w.id = ws.workout_id
  where ws.workout_id = p_workout_id
    and w.created_by = auth.uid();
$$;

comment on function public.workout_delete_blockers(uuid) is
  'RPC: how many scheduled slots reference this workout, so a delete can be refused in domain terms rather than as a 23503.';

revoke execute on function public.workout_delete_blockers(uuid) from public, anon;
grant execute on function public.workout_delete_blockers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_workout: reconcile exercises by natural key (B3, C-3)
-- ---------------------------------------------------------------------------
-- The builder deleted every workout_exercises row and reinserted, so each
-- save handed every row a new primary key. Anything holding an id went
-- stale, and realtime subscribers saw a delete/insert storm instead of
-- updates. Reconciling on (workout_id, sort_order) leaves unchanged rows
-- alone (R3).
--
-- p_expected_updated_at is optimistic concurrency: two coaches editing one
-- workout would otherwise silently lose whichever save landed second (C3).
-- Pass null to skip the check.

create function public.save_workout(
  p_payload jsonb,
  p_workout_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workout_id uuid := p_workout_id;
  v_current timestamptz;
  v_exercise jsonb;
  v_index int := 0;
  v_keep int[] := '{}';
begin
  if v_workout_id is null then
    insert into public.workouts (
      name, description, type, estimated_duration_minutes, equipment, warmup_id, created_by
    )
    values (
      p_payload->>'name',
      nullif(p_payload->>'description', ''),
      coalesce((p_payload->>'type')::public.workout_type, 'workout'),
      (p_payload->>'estimated_duration_minutes')::int,
      case when p_payload->'equipment' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(coalesce(p_payload->'equipment', '[]'::jsonb))) end,
      nullif(p_payload->>'warmup_id', '')::uuid,
      auth.uid()
    )
    returning id into v_workout_id;
  else
    -- SECURITY DEFINER bypasses RLS, so ownership must be checked here or
    -- any authenticated user could rewrite any workout by id. Scoping the
    -- lookup itself (rather than a separate check) means a future edit
    -- cannot leave the update reachable without it.
    select updated_at into v_current
    from public.workouts
    where id = v_workout_id and created_by = auth.uid();

    if v_current is null then
      raise exception 'not_found_or_forbidden';
    end if;
    if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
      raise exception 'stale_write';
    end if;

    update public.workouts set
      name = p_payload->>'name',
      description = nullif(p_payload->>'description', ''),
      type = coalesce((p_payload->>'type')::public.workout_type, 'workout'),
      estimated_duration_minutes = (p_payload->>'estimated_duration_minutes')::int,
      equipment = case when p_payload->'equipment' = 'null'::jsonb then null
                       else array(select jsonb_array_elements_text(coalesce(p_payload->'equipment', '[]'::jsonb))) end,
      warmup_id = nullif(p_payload->>'warmup_id', '')::uuid
    where id = v_workout_id;
  end if;

  -- Upsert each exercise in place, keyed by its position in the workout.
  for v_exercise in select * from jsonb_array_elements(coalesce(p_payload->'exercises', '[]'::jsonb))
  loop
    update public.workout_exercises set
      exercise_id = nullif(v_exercise->>'exercise_id', '')::uuid,
      mode = coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
      set_configs = coalesce(v_exercise->'set_configs', '[]'::jsonb),
      rest_seconds = (v_exercise->>'rest_seconds')::int,
      notes = nullif(v_exercise->>'notes', '')
    where workout_id = v_workout_id and sort_order = v_index;

    if not found then
      insert into public.workout_exercises (
        workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
      )
      values (
        v_workout_id,
        nullif(v_exercise->>'exercise_id', '')::uuid,
        v_index,
        coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
        coalesce(v_exercise->'set_configs', '[]'::jsonb),
        (v_exercise->>'rest_seconds')::int,
        nullif(v_exercise->>'notes', '')
      );
    end if;

    v_keep := array_append(v_keep, v_index);
    v_index := v_index + 1;
  end loop;

  -- Only rows past the new end are actually gone.
  delete from public.workout_exercises
  where workout_id = v_workout_id and not (sort_order = any(v_keep));

  return v_workout_id;
end;
$$;

comment on function public.save_workout(jsonb, uuid, timestamptz) is
  'RPC: creates or updates a workout and reconciles its exercises by (workout_id, sort_order) instead of deleting and reinserting, so unchanged rows keep their ids (R3). p_expected_updated_at gives optimistic concurrency — pass the updated_at the editor loaded and a competing save raises stale_write rather than silently winning (C3). Raises: not_found_or_forbidden, stale_write.';

revoke execute on function public.save_workout(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_workout(jsonb, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- save_program: reconcile phases and schedules by natural key (B3, C-3)
-- ---------------------------------------------------------------------------
-- The builder deleted every program_phases row (cascading their
-- week_schedules) and reinserted, so each save handed every phase and every
-- scheduled slot a new primary key. Reconciling on (program_id, sort_order)
-- for phases and (scope, week_number, day_of_week) for schedules leaves
-- unchanged rows alone (R3).
--
-- Week-number scoping is preserved exactly as the builder defines it:
--   phased -> rows carry phase_id, week_number is PHASE-LOCAL (1..phase.weeks)
--   flat   -> rows carry program_id, week_number is GLOBAL (1..weeks)
-- A program has one or the other, never both (enforced by week_schedules'
-- check constraint), so switching modes clears the other scope's rows.

create function public.save_program(
  p_payload jsonb,
  p_program_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program_id uuid := p_program_id;
  v_current timestamptz;
  v_phased boolean := coalesce((p_payload->>'phased')::boolean, false);
  v_weeks int := (p_payload->>'weeks')::int;
  v_phase jsonb;
  v_index int := 0;
  v_phase_id uuid;
  v_phase_ids uuid[] := '{}';
  v_sort_orders int[] := '{}';
  v_slot jsonb;
begin
  if v_program_id is null then
    insert into public.programs (name, description, weeks, created_by)
    values (
      p_payload->>'name',
      nullif(p_payload->>'description', ''),
      v_weeks,
      auth.uid()
    )
    returning id into v_program_id;
  else
    -- SECURITY DEFINER bypasses RLS: scope by owner or any authenticated
    -- user could rewrite any coach's program by id.
    select updated_at into v_current
    from public.programs
    where id = v_program_id and created_by = auth.uid();

    if v_current is null then
      raise exception 'not_found_or_forbidden';
    end if;
    if p_expected_updated_at is not null and v_current <> p_expected_updated_at then
      raise exception 'stale_write';
    end if;

    update public.programs set
      name = p_payload->>'name',
      description = nullif(p_payload->>'description', ''),
      weeks = v_weeks
    where id = v_program_id;
  end if;

  -- Phases, reconciled by position. A phase that keeps its slot keeps its id,
  -- so its week_schedules rows survive with it.
  if v_phased then
    for v_phase in select * from jsonb_array_elements(coalesce(p_payload->'phases', '[]'::jsonb))
    loop
      update public.program_phases set
        name = nullif(v_phase->>'name', ''),
        weeks = (v_phase->>'weeks')::int,
        active_days = array(
          select jsonb_array_elements_text(coalesce(v_phase->'active_days', '[]'::jsonb))
        )::public.day_of_week[]
      where program_id = v_program_id and sort_order = v_index
      returning id into v_phase_id;

      if v_phase_id is null then
        insert into public.program_phases (program_id, name, sort_order, weeks, active_days)
        values (
          v_program_id,
          nullif(v_phase->>'name', ''),
          v_index,
          (v_phase->>'weeks')::int,
          array(
            select jsonb_array_elements_text(coalesce(v_phase->'active_days', '[]'::jsonb))
          )::public.day_of_week[]
        )
        returning id into v_phase_id;
      end if;

      v_phase_ids := array_append(v_phase_ids, v_phase_id);
      v_sort_orders := array_append(v_sort_orders, v_index);
      v_index := v_index + 1;
      v_phase_id := null;
    end loop;
  end if;

  -- Phases past the new end are genuinely gone (their schedules cascade).
  delete from public.program_phases
  where program_id = v_program_id and not (sort_order = any(v_sort_orders));

  -- Schedule slots. `slots` is a flat array of
  -- {phase_index?, week_number, day_of_week, workout_id} so both modes share
  -- one path; phase_index resolves against the phases just reconciled.
  for v_slot in select * from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb))
  loop
    if v_phased then
      v_phase_id := v_phase_ids[(v_slot->>'phase_index')::int + 1];
      if v_phase_id is null then
        continue; -- slot referenced a phase that no longer exists
      end if;

      update public.week_schedules set workout_id = (v_slot->>'workout_id')::uuid
      where phase_id = v_phase_id
        and week_number = (v_slot->>'week_number')::int
        and day_of_week = (v_slot->>'day_of_week')::public.day_of_week;

      if not found then
        insert into public.week_schedules (phase_id, week_number, day_of_week, workout_id)
        values (
          v_phase_id,
          (v_slot->>'week_number')::int,
          (v_slot->>'day_of_week')::public.day_of_week,
          (v_slot->>'workout_id')::uuid
        );
      end if;
    else
      update public.week_schedules set workout_id = (v_slot->>'workout_id')::uuid
      where program_id = v_program_id
        and week_number = (v_slot->>'week_number')::int
        and day_of_week = (v_slot->>'day_of_week')::public.day_of_week;

      if not found then
        insert into public.week_schedules (program_id, week_number, day_of_week, workout_id)
        values (
          v_program_id,
          (v_slot->>'week_number')::int,
          (v_slot->>'day_of_week')::public.day_of_week,
          (v_slot->>'workout_id')::uuid
        );
      end if;
    end if;
  end loop;

  -- Drop slots the payload no longer contains, in whichever scope applies.
  -- Switching modes leaves the other scope with no surviving rows, which is
  -- what clears it.
  delete from public.week_schedules ws
  where (
      (ws.program_id = v_program_id)
      or (ws.phase_id = any(v_phase_ids))
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload->'slots', '[]'::jsonb)) s
      where (s->>'week_number')::int = ws.week_number
        and (s->>'day_of_week')::public.day_of_week = ws.day_of_week
        and case
              when v_phased then v_phase_ids[(s->>'phase_index')::int + 1] = ws.phase_id
              else ws.program_id = v_program_id
            end
    );

  return v_program_id;
end;
$$;

comment on function public.save_program(jsonb, uuid, timestamptz) is
  'RPC: creates or updates a program and reconciles its phases by (program_id, sort_order) and its schedule slots by (scope, week_number, day_of_week), instead of deleting and reinserting — so unchanged phases and slots keep their ids (R3). `slots` is a flat array carrying phase_index in phased mode, so both scopings share one path. p_expected_updated_at gives optimistic concurrency (C3). Raises: not_found_or_forbidden, stale_write.';

revoke execute on function public.save_program(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_program(jsonb, uuid, timestamptz) to authenticated;
