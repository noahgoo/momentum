-- ---------------------------------------------------------------------------
-- 0043: every assignment starts on a Monday.
--
-- assignments.start_date used to be any weekday, and week N was
--   [start + 7(N-1), start + 7N - 1]
-- so a Wednesday start made every "week" run Wed..Tue. The coach editor lists
-- days Mon..Sun, which put "Mon Oct 5" above "Tue Sep 29" inside one week.
-- With a Monday start, a program week IS a calendar week and no weekday
-- arithmetic is needed anywhere.
--
-- Three parts, in this order (the constraint can only land after the data is
-- clean):
--
--   1. assign_program refuses a non-Monday start. Past Mondays stay allowed:
--      a coach can assign a program that began earlier this week.
--   2. Backfill every existing non-Monday assignment WITHOUT changing which
--      session any calendar date resolves to (R5; logs, overrides and
--      change_requests are keyed by absolute date and must stay valid).
--   3. CHECK (isodow(start_date) = 1), and session_scheduled_date loses its
--      weekday-offset term.
--
-- Backfill math. Old start S has weekday index s (Mon=0..Sun=6); the new start
-- is M = S - s. An old slot (week w, day d):
--   d >= s : falls on the same date under M with the same (w, d).
--   d <  s : falls on (w + 1, d) under M. The week-1 days before the old start
--            are therefore empty, and the last old week's early days spill
--            into a new final week.
-- So: sessions with d < s move to global week + 1, and the program grows by
-- one week when any of them were in its last week.
--
-- Only the assignment's own instance copy is rewritten (programs.client_id is
-- set). Templates are never touched. Sessions are keyed by (scope, week, day),
-- not date (R3), so no other row needs rewriting.
--
-- Overlap with an earlier assignment. The resolver picks the assignment with
-- the latest start_date <= the date. Moving a start back to M hands the days
-- M..S-1 to this assignment, which used to belong to the previous one. Where
-- the previous assignment resolved a session on one of those days, an explicit
-- override is written on this assignment pointing at that same session, so the
-- date keeps resolving as it did.
--
-- Idempotent: only non-Monday rows are selected, and the constraint is added
-- last.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. assign_program: refuse a non-Monday start
-- ---------------------------------------------------------------------------

create or replace function public.assign_program(
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

  -- Re-checked here, not trusted from the picker (C5). A past Monday is fine.
  if p_start_date is null or extract(isodow from p_start_date) <> 1 then
    raise exception 'start_date_must_be_monday';
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
  'RPC: assigns a library program to a client by DEEP-COPYING it into client-owned instance rows, then deactivating any prior assignment and inserting the new one — all in one transaction. The client''s program is independent from assignment: editing the template afterwards never reaches them. The start date must be a Monday (a program week is a calendar week); a past Monday is allowed. Raises: not_your_client, start_date_must_be_monday, program_not_found, not_a_template.';

-- ---------------------------------------------------------------------------
-- 2. Backfill non-Monday assignments, date-preserving
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_s int;            -- old start's weekday index, Mon=0
  v_m date;           -- the Monday on or before the old start
  v_d date;
  v_prior uuid;
  v_max_new int;      -- highest global week any moved session lands in
  v_weeks int;
  v_last_phase uuid;
  v_last_prior int;
begin
  create temp table _mv (
    session_id uuid primary key,
    g int not null,            -- OLD global week
    in_phase boolean not null
  ) on commit drop;

  create temp table _po (
    phase_id uuid primary key,
    prior int not null,
    weeks int not null,
    is_last boolean not null
  ) on commit drop;

  for r in
    select a.id, a.client_id, a.program_id, a.start_date
    from public.assignments a
    where extract(isodow from a.start_date) <> 1
    order by a.start_date, a.created_at
  loop
    v_s := extract(isodow from r.start_date)::int - 1;
    v_m := r.start_date - v_s;

    -- A. Days M..S-1 move from the previous assignment to this one: pin each
    --    one that currently resolves to a session. Done BEFORE the start moves,
    --    while this assignment still starts after them.
    for v_d in select generate_series(v_m, r.start_date - 1, interval '1 day')::date
    loop
      v_prior := public.resolve_scheduled_workout(r.client_id, v_d);
      if v_prior is not null then
        insert into public.assignment_date_overrides (assignment_id, date, session_id)
        values (r.id, v_d, v_prior)
        on conflict (assignment_id, date) do nothing;
      end if;
    end loop;

    -- B. Sessions to move: day-of-week index < s, with their OLD global week.
    truncate _mv, _po;

    insert into _po (phase_id, prior, weeks, is_last)
    select ph.id,
           coalesce(sum(ph.weeks) over (
             order by ph.sort_order rows between unbounded preceding and 1 preceding
           ), 0)::int,
           coalesce(ph.weeks, 0),
           ph.sort_order = max(ph.sort_order) over ()
    from public.program_phases ph
    where ph.program_id = r.program_id;

    insert into _mv (session_id, g, in_phase)
    select s.id, s.week_number, false
    from public.sessions s
    where s.program_id = r.program_id
      and array_position(enum_range(null::public.day_of_week), s.day_of_week) <= v_s;

    insert into _mv (session_id, g, in_phase)
    select s.id, po.prior + s.week_number, true
    from public.sessions s
    join _po po on po.phase_id = s.phase_id
    where array_position(enum_range(null::public.day_of_week), s.day_of_week) <= v_s;

    -- C. Park the movers out of the way of the (scope, week, day) unique
    --    indexes, then place them. Targets never collide with non-movers: a
    --    mover lands on the same day-of-week, and every session on that day
    --    moves too.
    update public.sessions s
    set week_number = s.week_number + 100000
    from _mv m
    where m.session_id = s.id;

    -- Program-scoped: global week + 1.
    update public.sessions s
    set week_number = m.g + 1
    from _mv m
    where m.session_id = s.id and not m.in_phase;

    -- Phase-scoped: the phase that owns global week g+1 under the existing
    -- boundaries; past the end, the last phase absorbs it (and grows below).
    update public.sessions s
    set phase_id = po.phase_id,
        week_number = (m.g + 1) - po.prior
    from _mv m
    join _po po
      on ((m.g + 1) > po.prior and (m.g + 1) <= po.prior + po.weeks)
      or (po.is_last and (m.g + 1) > po.prior + po.weeks)
    where m.session_id = s.id and m.in_phase;

    -- D. Grow the program when a moved session landed past its end.
    select max(m.g) + 1 into v_max_new from _mv m;
    if v_max_new is not null then
      select p.weeks into v_weeks from public.programs p where p.id = r.program_id;
      if v_weeks is not null and v_max_new > v_weeks then
        update public.programs set weeks = v_max_new where id = r.program_id;
      end if;

      select po.phase_id, po.prior into v_last_phase, v_last_prior
      from _po po where po.is_last;
      if v_last_phase is not null and v_max_new - v_last_prior
           > (select ph.weeks from public.program_phases ph where ph.id = v_last_phase) then
        update public.program_phases
        set weeks = v_max_new - v_last_prior
        where id = v_last_phase;
      end if;
    end if;

    -- E. The start moves last; the assignments trigger refreshes the summary.
    update public.assignments set start_date = v_m where id = r.id;

    raise notice 'assignment %: start % -> %, % sessions shifted a week',
      r.id, r.start_date, v_m, (select count(*) from _mv);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The constraint, and the date inverse without its weekday offset
-- ---------------------------------------------------------------------------

alter table public.assignments
  add constraint assignments_start_is_monday
  check (extract(isodow from start_date) = 1);

comment on constraint assignments_start_is_monday on public.assignments is
  'A program week is a calendar week: week N spans [start + 7(N-1), start + 7(N-1) + 6] and day d sits at start + 7(N-1) + d. assign_program enforces the same rule with a domain error (start_date_must_be_monday); this is the backstop.';

create or replace function public.session_scheduled_date(p_session_id uuid)
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

  select a.* into v_assignment
  from public.assignments a
  where a.program_id = v_program_id
  order by a.start_date desc, a.created_at desc
  limit 1;

  if v_assignment.id is null then
    return null;
  end if;

  -- An override that moved THIS session elsewhere wins, mirroring resolve's
  -- override-wins rule. Otherwise start_date is a Monday, so the weekday's
  -- ordinal IS its offset into the week.
  return coalesce(
    (
      select ado.date from public.assignment_date_overrides ado
      where ado.assignment_id = v_assignment.id and ado.session_id = p_session_id
      limit 1
    ),
    v_assignment.start_date
      + ((v_global_week - 1) * 7)
      + (array_position(enum_range(null::public.day_of_week), v_session.day_of_week) - 1)
  );
end;
$$;

comment on function public.session_scheduled_date(uuid) is
  'The calendar date a session falls on for the client its program is assigned to — the documented INVERSE of resolve_scheduled_workout, sharing its week arithmetic and its phase flattening. start_date is always a Monday (0043), so the date is start + 7(week-1) + weekday offset. Returns NULL for a program with no assignment (a template), which is what makes "later" fall back to program order. An assignment_date_overrides row that moved this session wins, mirroring resolve''s override-wins rule. Any change to resolution logic changes BOTH functions in the same commit, with the round-trip assertion (R5).';

revoke execute on function public.session_scheduled_date(uuid) from public, anon, authenticated;
