-- ---------------------------------------------------------------------------
-- 0031: sessions — one row per program x week x day, owning its own exercises.
--
-- `workouts` carries three jobs at once: the thing a coach picks from, the
-- thing a program schedules, and the thing a client does. Which one a row is
-- gets inferred from `client_id`, so every query has to remember to filter on
-- it — and the one that forgot (the library builder's day picker) could delete
-- a client's schedule (see 0030).
--
-- Worse, `week_schedules.workout_id` is a POINTER, and `copy_program_tree`
-- de-duplicates with `select distinct ws.workout_id` (0020:89). Every week
-- that schedules the same workout shares ONE row, so a coach cannot vary week
-- 5's bench without varying week 3's, and editing any week rewrites the rest —
-- including past ones. Logs snapshot their own prescription (P1) so completed
-- days survive, but an unlogged past day changes underneath the client.
--
-- After the full split:
--   workouts           LIBRARY ONLY. client_id null = global, set = filed
--                      under one client. Never has a live dependent, because
--                      every scheduled slot is a copy, so every row is freely
--                      editable. Pickers read
--                      `client_id is null or client_id = :client`.
--   sessions           one row per program x week x day, a COPY of a library
--                      workout. Replaces week_schedules.
--   session_exercises  belongs to a session; the same shape as
--                      workout_exercises, so materializing is a straight copy.
--
-- This migration is PURELY ADDITIVE. `week_schedules` still exists and is
-- still what every function and both apps read; nothing populates or reads
-- `sessions` yet. 0032 materializes them, 0033/0034 move the RPCs across, and
-- 0035 drops the old world. Splitting it this way keeps each step reviewable
-- and leaves the app working after every one.
-- ---------------------------------------------------------------------------

create type public.session_section as enum ('warmup', 'main');

comment on type public.session_section is
  'Which half of a session an exercise row belongs to. This is what replaces workouts.warmup_id''s self-FK: a session OWNS its warm-up rather than pointing at another schedulable row. That self-FK is why copy_program_tree needs a re-link pass (0020:121) and why workouts_client_select needed the my_client_warmup_ids() workaround for the 42P17 recursion in 0024; a session''s warm-up is not separately schedulable, so it belongs to the aggregate.';

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references public.programs (id) on delete cascade,
  phase_id uuid references public.program_phases (id) on delete cascade,
  week_number int not null,
  day_of_week public.day_of_week not null,
  source_workout_id uuid references public.workouts (id) on delete set null,
  name text not null,
  description text,
  estimated_duration_minutes int,
  equipment text[],
  warmup_name text,
  warmup_source_workout_id uuid references public.workouts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((program_id is null) <> (phase_id is null))
);

comment on table public.sessions is
  'One scheduled day of work: a program x week x day, scoped to exactly one of program_id or phase_id. Replaces week_schedules. A session is a COPY of a library workout, never a pointer to one, so editing week 3 edits week 3 and nothing else. Ownership flows through the program — a template program''s sessions are library-side, an instance program''s belong to that one client.';

comment on column public.sessions.week_number is
  'PHASE-LOCAL (1..phase.weeks) when phase_id is set, GLOBAL (1..program.weeks) when program_id is set. Unchanged from week_schedules, and the convention resolve_scheduled_workout''s phase flattening depends on.';

comment on column public.sessions.source_workout_id is
  'Provenance: the public.workouts row this session was materialized from. Drives which later sessions count as "the same workout" when a coach pushes an edit forward, and the builder''s "edited since you picked it" badge. NULL once a coach builds a session freehand. `on delete set null` — a session outlives the library entry it came from (R4).';

comment on column public.sessions.name is
  'Snapshotted from the source workout at materialization, editable afterwards. Never joined live from workouts: a coach renaming a library entry must not rename a client''s already-scheduled day (R8).';

comment on column public.sessions.warmup_name is
  'Display name for this session''s warm-up half. NULL when the session has no section=''warmup'' rows.';

comment on column public.sessions.warmup_source_workout_id is
  'Provenance for the warm-up half; same contract as source_workout_id.';

-- Ported from week_schedules. These two also ARE the resolution lookups —
-- resolve_scheduled_workout probes (program_id, week_number, day_of_week) and
-- (phase_id, ...) for equality on all three columns — so no separate btree is
-- warranted, and their leading column being the cascade FK covers program and
-- phase deletes too.
create unique index sessions_program_week_day_key
  on public.sessions (program_id, week_number, day_of_week)
  where program_id is not null;

create unique index sessions_phase_week_day_key
  on public.sessions (phase_id, week_number, day_of_week)
  where phase_id is not null;

-- For the on-delete-set-null sweeps, and for finding later sessions in a
-- program that share a source when a coach pushes an edit forward.
create index sessions_source_workout_id_idx on public.sessions (source_workout_id);
create index sessions_warmup_source_workout_id_idx
  on public.sessions (warmup_source_workout_id);

create trigger set_updated_at
  before update on public.sessions
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- session_exercises
-- ---------------------------------------------------------------------------

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  section public.session_section not null default 'main',
  exercise_id uuid references public.exercises (id) on delete set null,
  sort_order int not null,
  mode public.exercise_mode not null default 'reps',
  set_configs jsonb not null default '[]'::jsonb,
  rest_seconds int,
  notes text,
  constraint session_exercises_set_configs_valid
    check (public.is_valid_set_configs(set_configs)),
  unique (session_id, section, sort_order) deferrable initially deferred
);

comment on table public.session_exercises is
  'Exercise entries within one session, in display order, split into the warm-up and main halves by `section`. Column-for-column identical to workout_exercises on purpose: materializing a session is a straight copy. `exercises` stays shared reference data and is not copied — session_exercises keep FKing into it, exactly as workout_exercises do.';

comment on column public.session_exercises.section is
  'warmup rows render in the warm-up card and are gated by workout_logs.warmup_completed; main rows are the logged workout. sort_order is per-section, which is what the unique constraint keys on.';

comment on column public.session_exercises.set_configs is
  'Identical contract to workout_exercises.set_configs: a jsonb array of {reps, weight, weight_unit, seconds, miles, pace_seconds, per_side, weight_delta}, shape enforced by is_valid_set_config() (0027), which rejects unknown keys.';

comment on column public.session_exercises.exercise_id is
  '`on delete set null`, matching exercise_logs.exercise_id (0020:265): a session survives its exercise-library entry being deleted, showing a nameless row rather than vanishing. workout_exercises predates that rule and is still NO ACTION.';

create index session_exercises_session_id_idx on public.session_exercises (session_id);
create index session_exercises_exercise_id_idx on public.session_exercises (exercise_id);

-- ---------------------------------------------------------------------------
-- RLS — policies ship with the tables that need them (R7)
-- ---------------------------------------------------------------------------

alter table public.sessions enable row level security;

create policy sessions_coach_all
  on public.sessions for all
  using (
    exists (
      select 1 from public.programs p
      where p.id = sessions.program_id and p.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.program_phases ph
      join public.programs p on p.id = ph.program_id
      where ph.id = sessions.phase_id and p.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = sessions.program_id and p.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.program_phases ph
      join public.programs p on p.id = ph.program_id
      where ph.id = sessions.phase_id and p.created_by = (select auth.uid())
    )
  );

comment on policy sessions_coach_all on public.sessions is
  'Coach full CRUD on sessions scoped to a program, or a phase of a program, they authored. Ported from week_schedules_coach_all: it keys on program/phase ownership and needs no workout join at all, which is what keeps it free of the recursion workouts_client_select hit. `(select auth.uid())` rather than a bare call so the planner hoists it to an InitPlan (0009).';

create policy sessions_client_select
  on public.sessions for select
  using (
    exists (
      select 1 from public.programs p
      where p.id = sessions.program_id
        and (
          p.client_id = (select auth.uid())
          or exists (
            select 1 from public.assignments a
            where a.client_id = (select auth.uid()) and a.program_id = p.id
          )
        )
    )
    or exists (
      select 1 from public.program_phases ph
      join public.programs p on p.id = ph.program_id
      where ph.id = sessions.phase_id
        and (
          p.client_id = (select auth.uid())
          or exists (
            select 1 from public.assignments a
            where a.client_id = (select auth.uid()) and a.program_id = p.id
          )
        )
    )
  );

comment on policy sessions_client_select on public.sessions is
  'Client can read sessions of any program, directly or through a phase, that is their own copy or that any assignment of theirs references. Deliberately NOT restricted to `a.active`: history must keep rendering after a reassign (B6). That is the week_schedules_client_select rule, chosen over workouts_client_select''s stricter one, because the two disagreed and only one of them can survive the split. Read-only — a client never writes a session.';

alter table public.session_exercises enable row level security;

create policy session_exercises_coach_all
  on public.session_exercises for all
  using (
    exists (
      select 1
      from public.sessions s
      left join public.programs p on p.id = s.program_id
      left join public.program_phases ph on ph.id = s.phase_id
      left join public.programs pp on pp.id = ph.program_id
      where s.id = session_exercises.session_id
        and coalesce(p.created_by, pp.created_by) = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.sessions s
      left join public.programs p on p.id = s.program_id
      left join public.program_phases ph on ph.id = s.phase_id
      left join public.programs pp on pp.id = ph.program_id
      where s.id = session_exercises.session_id
        and coalesce(p.created_by, pp.created_by) = (select auth.uid())
    )
  );

comment on policy session_exercises_coach_all on public.session_exercises is
  'Coach full CRUD on exercise rows of sessions in programs they authored. States ownership explicitly rather than leaning on sessions'' own policy, so tightening one table cannot silently loosen the other.';

create policy session_exercises_client_select
  on public.session_exercises for select
  using (
    exists (select 1 from public.sessions s where s.id = session_exercises.session_id)
  );

comment on policy session_exercises_client_select on public.session_exercises is
  'Client can read exercise rows for any session they can already select — sessions'' own RLS re-applies inside the subselect, which is the whole security of this policy. Deliberately the same bare-existence shape as workout_exercises_client_select (0005:191); preserve that property if you touch it. Not self-referential, so it cannot recur the way 0024''s policy did.';

-- 0016 grants blanket table privileges to `authenticated` and sets default
-- privileges for future tables, but only for objects the migration role
-- creates. Stated explicitly so a role change surfaces here rather than as a
-- 42501 at runtime. RLS still denies by default — the grant alone opens
-- nothing.
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.session_exercises to authenticated;
