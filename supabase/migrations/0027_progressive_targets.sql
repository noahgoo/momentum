-- ---------------------------------------------------------------------------
-- 0027: per-side reps, progressive target weights, and a real shape check on
-- set_configs.
--
-- Two new prescription fields ride inside the existing set_configs jsonb:
--
--   per_side      bool  "10 reps on EACH side" (lunges, single-arm rows)
--   weight_delta  num   signed increment off the client's LAST logged weight
--                       for this exercise + set number, e.g. 5 for "+5 lb".
--
-- weight_delta's PRESENCE selects the mode, and it takes precedence over
-- `weight` when both are set. They deliberately coexist: the coach's fixed
-- weight sits untouched under an active increment, so toggling the increment
-- off in the builder restores it with no extra machinery and no data loss.
--
-- Resolution happens in the mobile logger, against last_set_weights (added to
-- get_workout_day below), and the RESOLVED number is what lands in
-- set_logs.prescribed on save — history renders a fact, not a rule (P1).
--
-- set_configs has carried no constraint of any kind until now: any shape was
-- accepted, which is exactly why a serializer that misses a field fails
-- silently. is_valid_set_config() closes that, and rejects unknown keys so a
-- half-finished rename fails loudly at write time instead of dropping data.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Shape validation
-- ---------------------------------------------------------------------------

create function public.is_valid_set_config(p_config jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(p_config) = 'object'
    -- Every key must be one we know. This is the half that catches a typo'd
    -- or half-renamed field; without it a bad key is accepted and silently
    -- dropped by parseSetConfig on the way back out.
    and not exists (
      select 1
      from jsonb_object_keys(p_config) as k
      where k not in (
        'reps', 'weight', 'weight_unit', 'seconds', 'miles', 'pace_seconds',
        'per_side', 'weight_delta'
      )
    )
    -- JSON null counts as absent everywhere below, matching parseSetConfig
    -- (which drops non-finite values) and the seed, which ships explicit
    -- {"weight":null,"weight_unit":null} rows.
    --
    -- The coalesce is load-bearing: `->` on a MISSING key yields SQL NULL, and
    -- jsonb_typeof(NULL) is NULL, so a bare comparison would evaluate to NULL
    -- rather than true and quietly neuter the whole check. Folding an absent
    -- key into JSON null makes both spellings of "absent" take one path.
    and jsonb_typeof(coalesce(p_config->'reps', 'null'::jsonb))         in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'weight', 'null'::jsonb))       in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'seconds', 'null'::jsonb))      in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'miles', 'null'::jsonb))        in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'pace_seconds', 'null'::jsonb)) in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'weight_delta', 'null'::jsonb)) in ('number', 'null')
    and jsonb_typeof(coalesce(p_config->'per_side', 'null'::jsonb))     in ('boolean', 'null')
    and (
      jsonb_typeof(coalesce(p_config->'weight_unit', 'null'::jsonb)) = 'null'
      or p_config->>'weight_unit' in ('lbs', 'kg')
    )
    -- P6: a weight is meaningless without its unit, and that holds for an
    -- increment too — resolving "+5" against a prior needs both units to
    -- compare before they can be added.
    and (
      jsonb_typeof(coalesce(p_config->'weight', 'null'::jsonb)) <> 'number'
      or jsonb_typeof(coalesce(p_config->'weight_unit', 'null'::jsonb)) = 'string'
    )
    and (
      jsonb_typeof(coalesce(p_config->'weight_delta', 'null'::jsonb)) <> 'number'
      or jsonb_typeof(coalesce(p_config->'weight_unit', 'null'::jsonb)) = 'string'
    );
$$;

comment on function public.is_valid_set_config(jsonb) is
  'True when one set_configs element is a well-formed prescription: an object, no unrecognized keys, each value the right JSON type, and a weight or weight_delta accompanied by its weight_unit (P6). JSON null counts as absent, matching parseSetConfig. Note it deliberately PERMITS weight and weight_delta together — the delta wins, and the fixed weight is retained so the builder''s toggle is lossless.';

create function public.is_valid_set_configs(p_configs jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(p_configs) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(p_configs) as elem
      where not public.is_valid_set_config(elem)
    );
$$;

comment on function public.is_valid_set_configs(jsonb) is
  'True when a whole set_configs array is well-formed. Empty array passes — an exercise with no sets yet is a legal draft.';

alter table public.workout_exercises
  add constraint workout_exercises_set_configs_valid
  check (public.is_valid_set_configs(set_configs));

-- The two snapshot columns carry the same shape and get the same check, but
-- as a BACKSTOP only: save_workout_log below nulls an invalid snapshot rather
-- than rejecting the log. A client's performance data is irreplaceable; a
-- target snapshot is not.
alter table public.exercise_logs
  add constraint exercise_logs_prescribed_valid
  check (prescribed is null or public.is_valid_set_configs(prescribed));

alter table public.set_logs
  add constraint set_logs_prescribed_valid
  check (prescribed is null or public.is_valid_set_config(prescribed));

comment on column public.workout_exercises.set_configs is
  'jsonb array of per-set config objects: {reps, weight, weight_unit, seconds, miles, pace_seconds, per_side, weight_delta}. Shape is enforced by is_valid_set_config(), which rejects unknown keys. per_side means "this many reps on each side" (reps mode only). weight_delta is a signed increment off the client''s last logged weight for the same exercise and set number; its presence selects that mode and takes precedence over weight, which is retained underneath so the builder''s toggle loses nothing. Deviation from requirements'' jsonb[] — plain jsonb array is easier to validate/index and avoids Postgres array-of-jsonb quirks.';

-- ---------------------------------------------------------------------------
-- get_workout_day: add last_set_weights
--
-- The existing previous_log cannot drive a "+5 from last" target. It is the
-- single most recent completed log in ANY workout, so on any split routine
-- (trained yesterday, last squatted Tuesday) it holds no squat row at all and
-- the target would render blank while a real prior exists. This resolves the
-- last weight PER EXERCISE instead, however far back it was.
-- ---------------------------------------------------------------------------

create or replace function public.get_workout_day(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
  v_workout_id uuid;
  v_warmup_id uuid;
  v_assignment record;
  v_program record;
  v_end_date date;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  v_workout_id := public.resolve_scheduled_workout(v_client_id, p_date);

  select a.* into v_assignment
  from public.assignments a
  where a.client_id = v_client_id and a.active
  limit 1;

  if v_assignment.id is not null then
    select p.* into v_program from public.programs p where p.id = v_assignment.program_id;
    v_end_date := v_assignment.start_date
      + (coalesce(nullif(v_program.weeks, 0), 1) * 7 - 1);
  end if;

  select warmup_id into v_warmup_id from public.workouts where id = v_workout_id;

  return jsonb_build_object(
    'workout', (select to_jsonb(w) from public.workouts w where w.id = v_workout_id),
    'exercises', coalesce((
      select jsonb_agg(to_jsonb(we) || jsonb_build_object(
               'exercises', (select to_jsonb(e) from public.exercises e where e.id = we.exercise_id))
             order by we.sort_order)
      from public.workout_exercises we
      where we.workout_id = v_workout_id
    ), '[]'::jsonb),
    'warmup', (select to_jsonb(w) from public.workouts w where w.id = v_warmup_id),
    'warmup_exercises', coalesce((
      select jsonb_agg(to_jsonb(we) || jsonb_build_object(
               'exercises', (select to_jsonb(e) from public.exercises e where e.id = we.exercise_id))
             order by we.sort_order)
      from public.workout_exercises we
      where we.workout_id = v_warmup_id
    ), '[]'::jsonb),
    'log', (
      select to_jsonb(wl) || jsonb_build_object('exercise_logs', coalesce((
        select jsonb_agg(to_jsonb(el) || jsonb_build_object('set_logs', coalesce((
          select jsonb_agg(to_jsonb(sl) order by sl.set_number)
          from public.set_logs sl where sl.exercise_log_id = el.id
        ), '[]'::jsonb)) order by el.sort_order)
        from public.exercise_logs el where el.workout_log_id = wl.id
      ), '[]'::jsonb))
      from public.workout_logs wl
      where wl.client_id = v_client_id and wl.date = p_date
    ),
    -- "Last time" = the client's most recent completed log before this date,
    -- in ANY workout. The logger pairs prior sets by exercise, so scoping to
    -- the same workout row only blanked the column after a reassign (P-4).
    'previous_log', (
      select to_jsonb(wl) || jsonb_build_object('exercise_logs', coalesce((
        select jsonb_agg(to_jsonb(el) || jsonb_build_object('set_logs', coalesce((
          select jsonb_agg(to_jsonb(sl) order by sl.set_number)
          from public.set_logs sl where sl.exercise_log_id = el.id
        ), '[]'::jsonb)) order by el.sort_order)
        from public.exercise_logs el where el.workout_log_id = wl.id
      ), '[]'::jsonb))
      from public.workout_logs wl
      where wl.client_id = v_client_id and wl.completed and wl.date < p_date
      order by wl.date desc
      limit 1
    ),
    -- Per-exercise last weights, for resolving weight_delta targets. Keyed
    -- {exercise_id: {set_number: {weight, weight_unit}}} so the logger looks
    -- up by identity rather than array position (P3).
    --
    -- weight_entered is the filter that matters: per P2 a bare check-off
    -- records no real lift, and progressing a client off a number they never
    -- typed is the exact failure P2 exists to prevent.
    'last_set_weights', coalesce((
      with scheduled as (
        select distinct we.exercise_id
        from public.workout_exercises we
        where we.workout_id = v_workout_id and we.exercise_id is not null
      ),
      latest as (
        select distinct on (el.exercise_id)
               el.exercise_id,
               el.id as exercise_log_id
        from public.exercise_logs el
        join public.workout_logs wl on wl.id = el.workout_log_id
        join scheduled s on s.exercise_id = el.exercise_id
        where wl.client_id = v_client_id
          and wl.completed
          and wl.date < p_date
          and exists (
            select 1 from public.set_logs sl
            where sl.exercise_log_id = el.id
              and sl.weight_entered
              and sl.weight is not null
          )
        order by el.exercise_id, wl.date desc
      )
      select jsonb_object_agg(l.exercise_id::text, l.sets)
      from (
        select latest.exercise_id,
               jsonb_object_agg(
                 sl.set_number::text,
                 jsonb_build_object('weight', sl.weight, 'weight_unit', sl.weight_unit)
               ) as sets
        from latest
        join public.set_logs sl on sl.exercise_log_id = latest.exercise_log_id
        where sl.weight_entered and sl.weight is not null
        group by latest.exercise_id
      ) l
    ), '{}'::jsonb),
    'in_range', v_assignment.id is not null
      and p_date >= v_assignment.start_date
      and p_date <= v_end_date,
    'program_start_date', v_assignment.start_date,
    'program_end_date', v_end_date
  );
end;
$$;

comment on function public.get_workout_day(date) is
  'RPC: everything the day screen renders for the calling client on a date — resolved workout, its exercises, warmup and warmup exercises, that date''s log with children, the previous completed log, per-exercise last logged weights (last_set_weights, for resolving weight_delta targets), and the program window. One round trip in place of a four-level client-side waterfall, and the only place schedule resolution happens. Raises: forbidden.';

revoke execute on function public.get_workout_day(date) from public, anon;
grant execute on function public.get_workout_day(date) to authenticated;

