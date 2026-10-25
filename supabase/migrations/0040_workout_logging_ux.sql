-- Workout logging UX: load type, distance units, max-effort targets, unit prefs.
--
-- Nothing is in prod, so this renames cleanly rather than carrying a
-- compatibility layer. Three things change:
--
--  1. set_configs gains load_type, distance, distance_unit and max_effort,
--     and loses `miles` (a key named miles that holds km would lie). per_side
--     becomes legal in time mode. is_valid_set_config() is the single place
--     the key list lives, so it is redefined here and every constraint that
--     calls it picks the change up.
--  2. set_logs records the unit its distance was logged in (P6 for distance,
--     same as weight_unit), and actual_miles becomes actual_distance.
--  3. profiles carry the client's preferred weight and distance units. They
--     SEED new prescriptions and unprescribed entries; a prescription still
--     carries its own unit, so changing a preference never rewrites anything.
-- ---------------------------------------------------------------------------

create type public.distance_unit as enum ('mi', 'km');
create type public.load_type as enum ('total', 'each_hand', 'bodyweight', 'bodyweight_plus', 'assisted');

-- ---------------------------------------------------------------------------
-- 1. Validator
-- ---------------------------------------------------------------------------

create or replace function public.is_valid_set_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(p_config) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(p_config) as k
      where k not in (
        'reps', 'weight', 'weight_unit', 'seconds', 'distance', 'distance_unit',
        'pace_seconds', 'per_side', 'weight_delta', 'load_type', 'max_effort'
      )
    )
    -- JSON null counts as absent; coalesce folds a missing key into it so a
    -- bare `->` returning SQL NULL cannot quietly neuter a check.
    and jsonb_typeof(coalesce(p_config->'reps', 'null'::jsonb))         in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'weight', 'null'::jsonb))       in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'seconds', 'null'::jsonb))      in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'distance', 'null'::jsonb))     in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'pace_seconds', 'null'::jsonb)) in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'weight_delta', 'null'::jsonb)) in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'per_side', 'null'::jsonb))     in ('boolean', 'null')
    and jsonb_typeof(coalesce(p_config->'max_effort', 'null'::jsonb))   in ('boolean', 'null')
    and (
      jsonb_typeof(coalesce(p_config->'weight_unit', 'null'::jsonb)) = 'null'
      or p_config->>'weight_unit' in ('lbs', 'kg')
    )
    and (
      jsonb_typeof(coalesce(p_config->'distance_unit', 'null'::jsonb)) = 'null'
      or p_config->>'distance_unit' in ('mi', 'km')
    )
    and (
      jsonb_typeof(coalesce(p_config->'load_type', 'null'::jsonb)) = 'null'
      or p_config->>'load_type' in ('total', 'each_hand', 'bodyweight', 'bodyweight_plus', 'assisted')
    )
    -- P6: a weight is meaningless without its unit, increments included.
    and (
      jsonb_typeof(coalesce(p_config->'weight', 'null'::jsonb)) <> 'number'
      or jsonb_typeof(coalesce(p_config->'weight_unit', 'null'::jsonb)) = 'string'
    )
    and (
      jsonb_typeof(coalesce(p_config->'weight_delta', 'null'::jsonb)) <> 'number'
      or jsonb_typeof(coalesce(p_config->'weight_unit', 'null'::jsonb)) = 'string'
    )
    -- Same for distance, and for a pace, which is time per distance unit.
    and (
      jsonb_typeof(coalesce(p_config->'distance', 'null'::jsonb)) <> 'number'
      or jsonb_typeof(coalesce(p_config->'distance_unit', 'null'::jsonb)) = 'string'
    )
    and (
      jsonb_typeof(coalesce(p_config->'pace_seconds', 'null'::jsonb)) <> 'number'
      or jsonb_typeof(coalesce(p_config->'distance_unit', 'null'::jsonb)) = 'string'
    );
$$;

comment on function public.is_valid_set_config(jsonb) is
  'True when one set_configs element is a well-formed prescription: an object, no unrecognized keys, each value the right JSON type, and a weight/weight_delta accompanied by weight_unit and a distance/pace_seconds accompanied by distance_unit (P6). JSON null counts as absent, matching parseSetConfig. Deliberately PERMITS weight and weight_delta together -- the delta wins and the fixed weight is retained so the builder''s toggle is lossless.';

-- ---------------------------------------------------------------------------
-- 2. Rewrite existing rows: miles -> distance + distance_unit
-- ---------------------------------------------------------------------------

create function pg_temp.migrate_set_config(p_config jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_config) = 'object' and (p_config ? 'miles' or p_config ? 'pace_seconds')
      then (p_config - 'miles')
           || case when p_config ? 'miles' then jsonb_build_object('distance', p_config->'miles') else '{}'::jsonb end
           || jsonb_build_object('distance_unit', 'mi')
    else p_config
  end;
$$;

create function pg_temp.migrate_set_configs(p_configs jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_configs) = 'array'
      then coalesce(
        (select jsonb_agg(pg_temp.migrate_set_config(e) order by ord)
         from jsonb_array_elements(p_configs) with ordinality as t(e, ord)),
        '[]'::jsonb)
    else p_configs
  end;
$$;

update public.workout_exercises set set_configs = pg_temp.migrate_set_configs(set_configs);
update public.session_exercises set set_configs = pg_temp.migrate_set_configs(set_configs);
update public.exercise_logs set prescribed = pg_temp.migrate_set_configs(prescribed) where prescribed is not null;
update public.set_logs set prescribed = pg_temp.migrate_set_config(prescribed) where prescribed is not null;

comment on column public.workout_exercises.set_configs is
  'jsonb array of per-set config objects: {reps, weight, weight_unit, seconds, distance, distance_unit, pace_seconds, per_side, weight_delta, load_type, max_effort}. Shape is enforced by is_valid_set_config(), which rejects unknown keys. per_side means "this much on each side" (reps or time mode). load_type says what the weight means (each dumbbell, total, bodyweight, bodyweight plus added load, assisted). max_effort means "as many reps / as long as you can": reps or seconds may then be absent, and absence means max, not missing. pace_seconds is per distance_unit. weight_delta is a signed increment off the client''s last logged weight for the same exercise and set number; its presence selects that mode and takes precedence over weight, which is retained underneath so the builder''s toggle loses nothing.';

comment on column public.session_exercises.set_configs is
  'Identical contract to workout_exercises.set_configs. See that column''s comment for the key list; is_valid_set_config() enforces it.';

comment on column public.set_logs.prescribed is
  'This set''s target as it stood at log time (P1): a snapshot of one set_configs element, including load_type and the weight/distance units. History renders targets from here, never from the live workout.';

-- ---------------------------------------------------------------------------
-- 3. set_logs: distance unit travels with the number
-- ---------------------------------------------------------------------------

alter table public.set_logs rename column actual_miles to actual_distance;
alter table public.set_logs add column distance_unit public.distance_unit;
update public.set_logs set distance_unit = 'mi' where actual_distance is not null;
alter table public.set_logs
  add constraint set_logs_distance_has_unit
  check (actual_distance is null or distance_unit is not null);

comment on column public.set_logs.actual_distance is 'Client-entered distance (performance). Unit is distance_unit.';
comment on column public.set_logs.distance_unit is 'Unit actual_distance was logged in. Required whenever actual_distance is set (P6).';

-- ---------------------------------------------------------------------------
-- 4. exercises: defaults a new prescription starts from
-- ---------------------------------------------------------------------------

alter table public.exercises rename column default_miles to default_distance;
alter table public.exercises add column default_distance_unit public.distance_unit;
alter table public.exercises add column default_load_type public.load_type;
update public.exercises set default_distance_unit = 'mi' where default_distance is not null;
alter table public.exercises
  add constraint exercises_default_distance_has_unit
  check (default_distance is null or default_distance_unit is not null);

comment on column public.exercises.default_load_type is 'What a weight on this exercise means by default (e.g. each_hand for a dumbbell row). Seeds the builder; the prescription snapshots its own load_type.';

-- ---------------------------------------------------------------------------
-- 5. profiles: preferred units
-- ---------------------------------------------------------------------------

alter table public.profiles add column weight_unit public.weight_unit not null default 'lbs';
alter table public.profiles add column distance_unit public.distance_unit not null default 'mi';

comment on column public.profiles.weight_unit is 'Preferred weight unit. Seeds new prescriptions for this client and their own unprescribed entries; never rewrites a stored weight.';
comment on column public.profiles.distance_unit is 'Preferred distance unit. Same role as weight_unit.';

-- ---------------------------------------------------------------------------
-- 6. save_workout_log: write actual_distance + distance_unit
-- ---------------------------------------------------------------------------

create or replace function public.save_workout_log(
  p_date date,
  p_workout_id uuid,
  p_completed boolean,
  p_exercises jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
  v_log_id uuid;
  v_log_exists boolean;
  v_existing_session_id uuid;
  v_resolved_session_id uuid;
  v_exercise jsonb;
  v_exercise_log_id uuid;
  v_set jsonb;
  v_prescribed jsonb;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  select true, session_id into v_log_exists, v_existing_session_id
  from public.workout_logs
  where client_id = v_client_id and date = p_date;
  v_log_exists := coalesce(v_log_exists, false);

  v_resolved_session_id := public.resolve_scheduled_workout(v_client_id, p_date);

  -- A log may only be CREATED for a date that actually has a workout.
  if not v_log_exists and v_resolved_session_id is null then
    raise exception 'not_scheduled';
  end if;

  -- p_workout_id must be the session actually scheduled today, or -- for an
  -- already-existing log -- the session that was on it before, so editing a
  -- log survives a later reschedule (the client did the work; the record
  -- stays). Anything else is a foreign session id the caller has no claim to,
  -- which the raw ownerless lookup below would otherwise happily disclose.
  if p_workout_id is distinct from v_resolved_session_id
     and (not v_log_exists or p_workout_id is distinct from v_existing_session_id) then
    raise exception 'not_scheduled';
  end if;

  -- warmup_completed is deliberately absent: it belongs to
  -- set_warmup_completed. One writer per column (docs/rules/notifications.md W1).
  -- p_workout_id is a SESSION id now. The parameter name is unchanged so an
  -- older mobile build keeps working; it passes back whatever
  -- get_workout_day handed it. session_name is snapshotted so history
  -- renders the name the client was given, and still renders after the
  -- session is rescheduled away (R8).
  insert into public.workout_logs (client_id, date, session_id, session_name, completed, completed_at)
  values (
    v_client_id,
    p_date,
    p_workout_id,
    (select s.name from public.sessions s where s.id = p_workout_id),
    p_completed,
    case when p_completed then now() else null end
  )
  on conflict (client_id, date) do update set
    session_id = excluded.session_id,
    session_name = excluded.session_name,
    completed = excluded.completed,
    completed_at = excluded.completed_at
  returning id into v_log_id;

  -- Replace children wholesale. Safe here in a way the client-side version
  -- was not: this is one transaction, so a failure rolls the delete back
  -- rather than leaving the log stripped (R3 permits a full replace inside a
  -- SQL function).
  delete from public.exercise_logs where workout_log_id = v_log_id;

  for v_exercise in select * from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
  loop
    v_prescribed := v_exercise->'prescribed';
    if v_prescribed is not null and not public.is_valid_set_configs(v_prescribed) then
      v_prescribed := null;
    end if;

    insert into public.exercise_logs (
      workout_log_id, exercise_id, exercise_name, mode, sort_order, prescribed
    )
    values (
      v_log_id,
      nullif(v_exercise->>'exercise_id', '')::uuid,
      coalesce(v_exercise->>'exercise_name', 'Exercise'),
      coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
      (v_exercise->>'sort_order')::int,
      v_prescribed
    )
    returning id into v_exercise_log_id;

    for v_set in select * from jsonb_array_elements(coalesce(v_exercise->'sets', '[]'::jsonb))
    loop
      v_prescribed := v_set->'prescribed';
      if v_prescribed is not null and not public.is_valid_set_config(v_prescribed) then
        v_prescribed := null;
      end if;

      insert into public.set_logs (
        exercise_log_id, set_number, completed, reps, weight, weight_unit,
        target_seconds, actual_seconds, actual_distance, distance_unit, prescribed, weight_entered
      )
      values (
        v_exercise_log_id,
        (v_set->>'set_number')::int,
        coalesce((v_set->>'completed')::boolean, false),
        (v_set->>'reps')::int,
        (v_set->>'weight')::numeric,
        (v_set->>'weight_unit')::public.weight_unit,
        (v_set->>'target_seconds')::int,
        (v_set->>'actual_seconds')::int,
        (v_set->>'actual_distance')::numeric,
        (v_set->>'distance_unit')::public.distance_unit,
        v_prescribed,
        coalesce((v_set->>'weight_entered')::boolean, false)
      );
    end loop;
  end loop;

  return v_log_id;
end;
$$;

comment on function public.save_workout_log(date, uuid, boolean, jsonb) is
  'RPC: creates or updates a client''s own workout log for a date, replacing its exercise/set children wholesale in one transaction. p_workout_id (a SESSION id; name kept for older mobile builds) must equal the session scheduled for that date, or the session already on the existing log for that date -- anything else is a foreign session id and is refused. Sets carry reps, weight + weight_unit, actual_distance + distance_unit, actual_seconds. Raises: forbidden, not_scheduled.';
