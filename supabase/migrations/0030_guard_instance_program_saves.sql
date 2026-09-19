-- ---------------------------------------------------------------------------
-- 0030: refuse save_program on a client's own copy of a program.
--
-- ClientHeaderCard linked a client's INSTANCE program (client_id set) at
-- /library/programs/:id, the same builder templates use. That builder's day
-- picker is useWorkouts(), which filters `client_id IS NULL`, so the instance's
-- client-stamped workout copies have no matching <option> and every day select
-- renders blank — against a schedule that is actually intact.
--
-- save_program reconciles slots by (scope, week_number, day_of_week), so acting
-- on that wrong display destroys data two ways: leaving a blanked cell alone
-- deletes the slot, and toggling an active-day pill strips that day from every
-- week at once. Picking a real option is worse still — it writes a LIBRARY
-- workout id into one client's schedule, re-sharing a template row across every
-- client assigned that program, which is exactly the isolation 0020 exists to
-- guarantee (B1, B2).
--
-- The builder now refuses an instance program before rendering the form. This
-- is the server half of that guard: the route stays reachable by URL, and RLS
-- cannot express "only rows whose client_id is null" for a SECURITY DEFINER
-- function that already scopes by created_by.
--
-- Removed once per-client schedules have an editor of their own.
-- ---------------------------------------------------------------------------

create or replace function public.save_program(
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

    -- A client's copy has no safe editor yet; see the header.
    if (select client_id from public.programs where id = v_program_id) is not null then
      raise exception 'not_a_template';
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
  'RPC: creates or updates a LIBRARY program and reconciles its phases by (program_id, sort_order) and its schedule slots by (scope, week_number, day_of_week), instead of deleting and reinserting — so unchanged phases and slots keep their ids (R3). `slots` is a flat array carrying phase_index in phased mode, so both scopings share one path. p_expected_updated_at gives optimistic concurrency (C3). Refuses a program with client_id set: the only builder that calls this lists library workouts only, so saving a client''s copy from it would delete their schedule or repoint it at shared template rows. Raises: not_found_or_forbidden, not_a_template, stale_write.';

revoke execute on function public.save_program(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_program(jsonb, uuid, timestamptz) to authenticated;
