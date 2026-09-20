-- ---------------------------------------------------------------------------
-- 0038: push one day's edit onto the client's later days.
--
-- session_scheduled_date is the documented INVERSE of
-- resolve_scheduled_workout (0033). That function computes
--   week_number = (date - start_date) / 7 + 1
--   day_of_week = enum_range(day_of_week)[isodow(date)]
-- and flattens phases to global weeks by sort_order. This inverts both, and
-- shares the flattening verbatim. THEY CHANGE TOGETHER, in one commit, with
-- the round-trip assertion in 0038_apply_session_assertions.sql (R5).
--
-- The day offset is the part a naive implementation gets wrong. Global week W
-- spans [start + (W-1)*7, start + W*7 - 1], and each ISO weekday occurs
-- exactly once in that span — but the span does not begin on a Monday unless
-- start_date is one. The offset is therefore measured from start_date's own
-- weekday, modulo 7. A fixture with a Monday start passes a broken
-- implementation, which is why 0038's suite uses a Wednesday.
-- ---------------------------------------------------------------------------

create function public.session_scheduled_date(p_session_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_program_id uuid;
  v_assignment public.assignments%rowtype;
  v_global_week int;
  v_day_ordinal int;
begin
  select * into v_session from public.sessions where id = p_session_id;
  if v_session.id is null then
    return null;
  end if;

  if v_session.program_id is not null then
    v_program_id := v_session.program_id;
    v_global_week := v_session.week_number;
  else
    select ph.program_id into v_program_id
    from public.program_phases ph where ph.id = v_session.phase_id;

    -- Same window function as resolve_scheduled_workout's phase_offsets.
    select coalesce(sum(prior.weeks), 0) + v_session.week_number
    into v_global_week
    from public.program_phases me
    join public.program_phases prior
      on prior.program_id = me.program_id and prior.sort_order < me.sort_order
    where me.id = v_session.phase_id;

    if v_global_week is null then
      v_global_week := v_session.week_number;
    end if;
  end if;

  -- The assignment this program is running under. A template has none, and
  -- returning null there is what makes "later" fall back to program order.
  select a.* into v_assignment
  from public.assignments a
  where a.program_id = v_program_id
  order by a.start_date desc, a.created_at desc
  limit 1;

  if v_assignment.id is null then
    return null;
  end if;

  -- An override that moved THIS session elsewhere wins, mirroring resolve's
  -- override-wins rule.
  return coalesce(
    (
      select ado.date from public.assignment_date_overrides ado
      where ado.assignment_id = v_assignment.id and ado.session_id = p_session_id
      limit 1
    ),
    v_assignment.start_date
      + ((v_global_week - 1) * 7)
      + ((array_position(enum_range(null::public.day_of_week), v_session.day_of_week)
          - extract(isodow from v_assignment.start_date)::int + 7) % 7)
  );
end;
$$;

comment on function public.session_scheduled_date(uuid) is
  'The calendar date a session falls on for the client its program is assigned to — the documented INVERSE of resolve_scheduled_workout, sharing its week arithmetic and its phase flattening. Returns NULL for a program with no assignment (a template), which is what makes "later" fall back to program order. An assignment_date_overrides row that moved this session wins, mirroring resolve''s override-wins rule. Any change to resolution logic changes BOTH functions in the same commit, with the round-trip assertion (R5).';

revoke execute on function public.session_scheduled_date(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- apply_session_to_future
-- ---------------------------------------------------------------------------

create function public.apply_session_to_future(
  p_session_id uuid,
  p_include_warmup boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_owner uuid;
  v_program_id uuid;
  v_client_id uuid;
  v_cutoff date;
  v_source_ordinal int;
  v_source_week int;
  v_candidate record;
  v_applied uuid[] := '{}';
  v_skipped_past int := 0;
  v_skipped_logged int := 0;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if v_session.id is null then
    raise exception 'not_found_or_forbidden';
  end if;

  select coalesce(p.created_by, pp.created_by), coalesce(p.id, pp.id)
  into v_owner, v_program_id
  from public.sessions s
  left join public.programs p on p.id = s.program_id
  left join public.program_phases ph on ph.id = s.phase_id
  left join public.programs pp on pp.id = ph.program_id
  where s.id = p_session_id;

  if v_owner is distinct from auth.uid() then
    raise exception 'not_found_or_forbidden';
  end if;

  -- Without a source there is nothing to match later days against: "the same
  -- workout in later weeks" is defined by shared provenance.
  if v_session.source_workout_id is null then
    raise exception 'no_source_workout';
  end if;

  select client_id into v_client_id from public.programs where id = v_program_id;

  -- The client's today, never the caller's clock (C1). A template program has
  -- no client and no cutoff — every later day is fair game.
  if v_client_id is not null then
    v_cutoff := public.client_today(v_client_id);
  end if;

  v_source_week := (
    select case
      when v_session.program_id is not null then v_session.week_number
      else coalesce((
        select sum(prior.weeks)
        from public.program_phases me
        join public.program_phases prior
          on prior.program_id = me.program_id and prior.sort_order < me.sort_order
        where me.id = v_session.phase_id
      ), 0) + v_session.week_number
    end
  );
  v_source_ordinal := array_position(
    enum_range(null::public.day_of_week), v_session.day_of_week
  );

  for v_candidate in
    select s.id, s.program_id, s.phase_id, s.week_number, s.day_of_week,
      case
        when s.program_id is not null then s.week_number
        else coalesce((
          select sum(prior.weeks)
          from public.program_phases me
          join public.program_phases prior
            on prior.program_id = me.program_id and prior.sort_order < me.sort_order
          where me.id = s.phase_id
        ), 0) + s.week_number
      end as global_week,
      array_position(enum_range(null::public.day_of_week), s.day_of_week) as day_ordinal
    from public.sessions s
    left join public.program_phases ph on ph.id = s.phase_id
    where (s.program_id = v_program_id or ph.program_id = v_program_id)
      and s.id <> p_session_id
      and s.source_workout_id = v_session.source_workout_id
  loop
    -- Strictly later in the program, by (global week, weekday).
    if v_candidate.global_week < v_source_week
       or (v_candidate.global_week = v_source_week
           and v_candidate.day_ordinal <= v_source_ordinal) then
      continue;
    end if;

    -- A day the client has already reached is not "future", however the
    -- program orders it. An unscheduled session (no resolvable date) counts
    -- as future, which is safe by construction: it cannot have a log.
    if v_cutoff is not null then
      if coalesce(public.session_scheduled_date(v_candidate.id), v_cutoff + 1) <= v_cutoff then
        v_skipped_past := v_skipped_past + 1;
        continue;
      end if;
    end if;

    -- A coach edit must never rewrite what a client already did (tier 3).
    if exists (
      select 1 from public.workout_logs wl where wl.session_id = v_candidate.id
    ) then
      v_skipped_logged := v_skipped_logged + 1;
      continue;
    end if;

    update public.sessions set
      name = v_session.name,
      description = v_session.description,
      estimated_duration_minutes = v_session.estimated_duration_minutes,
      equipment = v_session.equipment,
      warmup_name = case when p_include_warmup then v_session.warmup_name else warmup_name end
    where id = v_candidate.id;

    delete from public.session_exercises
    where session_id = v_candidate.id
      and (p_include_warmup or section = 'main');

    insert into public.session_exercises (
      session_id, section, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
    )
    select v_candidate.id, se.section, se.exercise_id, se.sort_order, se.mode,
           se.set_configs, se.rest_seconds, se.notes
    from public.session_exercises se
    where se.session_id = p_session_id
      and (p_include_warmup or se.section = 'main');

    v_applied := array_append(v_applied, v_candidate.id);
  end loop;

  return jsonb_build_object(
    'applied', coalesce(array_length(v_applied, 1), 0),
    'skipped_past', v_skipped_past,
    'skipped_logged', v_skipped_logged,
    'session_ids', to_jsonb(v_applied)
  );
end;
$$;

comment on function public.apply_session_to_future(uuid, boolean) is
  'RPC: copies one session''s contents onto every LATER session in the same program that was materialized from the same source_workout_id. "Later" is (global_week, day_of_week) order, so it works on a template program with no assignment at all. When the program IS assigned, a day is skipped unless session_scheduled_date() falls strictly after client_today() — the CLIENT''s today, never the caller''s (C1) — and any day that already has a workout_logs row is skipped outright, because a coach edit must never rewrite what a client already did. Returns {applied, skipped_past, skipped_logged, session_ids} so the UI can say what it did rather than claiming success. Raises: not_found_or_forbidden, no_source_workout.';

revoke execute on function public.apply_session_to_future(uuid, boolean) from public, anon;
grant execute on function public.apply_session_to_future(uuid, boolean) to authenticated;
