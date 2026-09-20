-- ---------------------------------------------------------------------------
-- 0036: the workout library gets categories and per-client shelves.
--
-- Two columns on `workouts`, now that the table has exactly one job:
--
--   category           free text, exactly like exercises.category. No enum and
--                      no lookup table — the facet list is derived from the
--                      rows a coach already has and offered through a
--                      datalist, so they coin one by typing it.
--   client_id          already existed, but it used to mean "this is a
--                      per-client COPY of a scheduled workout". Sessions are
--                      that now. It means one thing again: NULL is the global
--                      library, set files the entry under one client, and a
--                      picker reads `client_id is null or client_id = :client`.
--   source_workout_id  provenance for a duplicate or a promoted session.
--
-- The consequence worth stating: a library row never has a live dependent,
-- because every scheduled day is a copy. So every row here is freely
-- editable, global or client-scoped alike — there is nothing to protect.
-- ---------------------------------------------------------------------------

alter table public.workouts add column category text;
alter table public.workouts
  add column source_workout_id uuid references public.workouts (id) on delete set null;

comment on table public.workouts is
  'LIBRARY ONLY: a workout or warm-up a coach picks from when building a program. client_id NULL = global to this coach; client_id set = filed under one client. A library row never has a live dependent — every scheduled slot is a public.sessions copy — so every row here is freely editable.';

comment on column public.workouts.client_id is
  'NULL = global library entry; set = filed under one client and shown only in their picker. NOT a per-client copy of a scheduled workout; that is public.sessions. Picker queries read `client_id is null or client_id = :client`.';

comment on column public.workouts.category is
  'Free-text grouping ("push", "conditioning"). Same contract as exercises.category: nullable, no enum, no lookup table — facet values are derived from the rows already loaded (ExercisesPage.tsx) and offered through a datalist, so a coach coins one by typing it.';

comment on column public.workouts.source_workout_id is
  'Provenance: the library workout this one was copied or promoted from. NULL for an original. `on delete set null` — a descendant outlives its ancestor (R4).';

-- Needed for the on-delete-set-null sweep; without it every library delete
-- seq-scans workouts. No index on category, matching exercises.category: both
-- facet lists are computed in the browser from rows already loaded.
create index workouts_source_workout_id_idx on public.workouts (source_workout_id);

-- ---------------------------------------------------------------------------
-- save_workout: writes category, and can file a workout under one client
-- ---------------------------------------------------------------------------

create or replace function public.save_workout(
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
  v_client_id uuid := nullif(p_payload->>'client_id', '')::uuid;
begin
  -- A client-scoped library workout appears only in that client's picker, so
  -- filing one under someone else's client would leak it there.
  if v_client_id is not null and not public.is_coach_of(v_client_id) then
    raise exception 'not_your_client';
  end if;

  for v_exercise in select * from jsonb_array_elements(coalesce(p_payload->'exercises', '[]'::jsonb))
  loop
    if not public.is_valid_set_configs(coalesce(v_exercise->'set_configs', '[]'::jsonb)) then
      raise exception 'invalid_set_config';
    end if;
  end loop;

  if v_workout_id is null then
    insert into public.workouts (
      name, description, category, type, estimated_duration_minutes, equipment,
      warmup_id, created_by, client_id, source_workout_id
    )
    values (
      p_payload->>'name',
      nullif(p_payload->>'description', ''),
      nullif(p_payload->>'category', ''),
      coalesce((p_payload->>'type')::public.workout_type, 'workout'),
      (p_payload->>'estimated_duration_minutes')::int,
      case when p_payload->'equipment' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(coalesce(p_payload->'equipment', '[]'::jsonb))) end,
      nullif(p_payload->>'warmup_id', '')::uuid,
      auth.uid(),
      v_client_id,
      nullif(p_payload->>'source_workout_id', '')::uuid
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
      warmup_id = nullif(p_payload->>'warmup_id', '')::uuid,
      category = nullif(p_payload->>'category', ''),
      client_id = v_client_id
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
  where workout_id = v_workout_id and sort_order >= v_index;

  return v_workout_id;
end;
$$;
comment on function public.save_workout(jsonb, uuid, timestamptz) is
  'RPC: creates or updates a LIBRARY workout and its exercises in one transaction, reconciling workout_exercises by (workout_id, sort_order) so unchanged rows keep their ids (R3). Validates every set_configs element up front. `client_id` in the payload files the workout under one client, who must be the caller''s. p_expected_updated_at is optimistic concurrency (C3). Raises: not_found_or_forbidden, not_your_client, stale_write, invalid_set_config.';

revoke execute on function public.save_workout(jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.save_workout(jsonb, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- duplicate_workout: one transaction, replacing four client-side round trips
--
-- useWorkouts.ts copied a workout by reading it, reading its exercises,
-- inserting the copy and then inserting the children — four requests with no
-- transaction, so a dropped connection left a workout with no exercises or a
-- half-copied list (R2, violation B15). duplicate_program (0020) is the shape
-- this follows.
-- ---------------------------------------------------------------------------

create function public.duplicate_workout(
  p_workout_id uuid,
  p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.workouts%rowtype;
  v_new_id uuid;
begin
  select * into v_source from public.workouts where id = p_workout_id;
  if v_source.id is null or v_source.created_by is distinct from auth.uid() then
    raise exception 'not_found_or_forbidden';
  end if;

  if p_client_id is not null and not public.is_coach_of(p_client_id) then
    raise exception 'not_your_client';
  end if;

  insert into public.workouts (
    name, description, category, estimated_duration_minutes, equipment, type,
    warmup_id, created_by, client_id, source_workout_id
  )
  values (
    v_source.name || ' (copy)', v_source.description, v_source.category,
    v_source.estimated_duration_minutes, v_source.equipment, v_source.type,
    v_source.warmup_id, auth.uid(), p_client_id,
    -- Chain to the ORIGINAL ancestor, not the immediate parent, so a
    -- copy-of-a-copy still answers "which library entry is this".
    coalesce(v_source.source_workout_id, v_source.id)
  )
  returning id into v_new_id;

  insert into public.workout_exercises (
    workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select v_new_id, we.exercise_id, we.sort_order, we.mode, we.set_configs,
         we.rest_seconds, we.notes
  from public.workout_exercises we
  where we.workout_id = p_workout_id;

  return v_new_id;
end;
$$;

comment on function public.duplicate_workout(uuid, uuid) is
  'RPC: duplicates one of the calling coach''s library workouts and its exercises in one transaction, optionally filing the copy under a client. Replaces a four-round-trip client-side copy that could leave a workout with no exercises if the connection dropped mid-sequence (R2). source_workout_id chains to the original ancestor rather than the immediate parent. Raises: not_found_or_forbidden, not_your_client.';

revoke execute on function public.duplicate_workout(uuid, uuid) from public, anon;
grant execute on function public.duplicate_workout(uuid, uuid) to authenticated;
