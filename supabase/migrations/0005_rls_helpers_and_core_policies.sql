-- Wave 2.1: RLS helper functions + RLS on identity/content tables.
-- profiles, exercises, workouts, workout_exercises, programs, program_phases,
-- week_schedules, assignments, assignment_date_overrides.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.is_coach()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'coach'
  );
$$;

comment on function public.is_coach() is
  'True if the calling user is a coach. Never grant row access on this alone — always combine with an ownership check (created_by / coach_id / is_coach_of).';

create function public.is_coach_of(p_client_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = p_client_id and invited_by = auth.uid()
  );
$$;

comment on function public.is_coach_of(uuid) is
  'True if the calling user is the coach (invited_by) of p_client_id. Primary scoping helper for coach access to client-owned data.';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles for select
  using (id = auth.uid());

comment on policy profiles_select_own on public.profiles is 'Anyone can read their own profile row.';

create policy profiles_select_own_clients
  on public.profiles for select
  using (invited_by = auth.uid());

comment on policy profiles_select_own_clients on public.profiles is 'Coach can read the profile rows of clients they invited.';

create policy profiles_select_own_coach
  on public.profiles for select
  using (id = (select invited_by from public.profiles where id = auth.uid()));

comment on policy profiles_select_own_coach on public.profiles is 'Client can read their own coach''s profile row (for display).';

create policy profiles_update_own
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

comment on policy profiles_update_own on public.profiles is 'Anyone can update their own row; privilege-escalation columns are blocked separately by the prevent_profile_privilege_change trigger.';

create policy profiles_update_own_clients
  on public.profiles for update
  using (invited_by = auth.uid())
  with check (invited_by = auth.uid());

comment on policy profiles_update_own_clients on public.profiles is 'Coach can update rows of their own clients (e.g. display_name, disabled).';

-- Column-level WITH CHECK can't compare OLD vs NEW, so privilege fields
-- (role / invited_by / disabled) are guarded with a BEFORE UPDATE trigger
-- instead, scoped to the self-update path only.
create function public.prevent_profile_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = new.id and (
    new.role is distinct from old.role
    or new.invited_by is distinct from old.invited_by
    or new.disabled is distinct from old.disabled
  ) then
    raise exception 'cannot change role, invited_by, or disabled on your own profile';
  end if;
  return new;
end;
$$;

comment on function public.prevent_profile_privilege_change() is
  'Blocks a client from escalating privilege via their own self-update policy. Only applies when the row being updated is the caller''s own (auth.uid() = new.id); coach-driven updates to a client row are unaffected.';

create trigger prevent_profile_privilege_change
  before update on public.profiles
  for each row
  execute function public.prevent_profile_privilege_change();

-- ---------------------------------------------------------------------------
-- exercises
-- ---------------------------------------------------------------------------

alter table public.exercises enable row level security;

create policy exercises_coach_all
  on public.exercises for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

comment on policy exercises_coach_all on public.exercises is 'Coach full CRUD on exercises they authored. WITH CHECK prevents spoofing another coach''s created_by.';

create policy exercises_client_select
  on public.exercises for select
  using (
    created_by = (select invited_by from public.profiles where id = auth.uid())
  );

comment on policy exercises_client_select on public.exercises is 'Client can read exercises authored by their own coach.';

-- ---------------------------------------------------------------------------
-- workouts
-- ---------------------------------------------------------------------------

alter table public.workouts enable row level security;

create policy workouts_coach_all
  on public.workouts for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

comment on policy workouts_coach_all on public.workouts is 'Coach full CRUD on workouts they authored.';

create policy workouts_client_select
  on public.workouts for select
  using (
    client_id = auth.uid()
    or exists (
      select 1
      from public.assignments a
      join public.week_schedules ws
        on ws.program_id = a.program_id
        or ws.phase_id in (select id from public.program_phases where program_id = a.program_id)
      where a.client_id = auth.uid()
        and a.active
        and ws.workout_id = workouts.id
    )
    or exists (
      select 1
      from public.assignment_date_overrides ado
      join public.assignments a on a.id = ado.assignment_id
      where a.client_id = auth.uid()
        and ado.workout_id = workouts.id
    )
    or id in (select warmup_id from public.workouts w2 where w2.client_id = auth.uid())
  );

comment on policy workouts_client_select on public.workouts is 'Client can read a per-client copy of a workout, or any workout reachable from their active assignment''s program tree (scheduled or via a date override), or the warmup attached to a workout they can already read.';

-- ---------------------------------------------------------------------------
-- workout_exercises (child of workouts)
-- ---------------------------------------------------------------------------

alter table public.workout_exercises enable row level security;

create policy workout_exercises_coach_all
  on public.workout_exercises for all
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_exercises.workout_id and w.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_exercises.workout_id and w.created_by = auth.uid()
    )
  );

comment on policy workout_exercises_coach_all on public.workout_exercises is 'Coach full CRUD on exercise rows of workouts they own.';

create policy workout_exercises_client_select
  on public.workout_exercises for select
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_exercises.workout_id
    )
  );

comment on policy workout_exercises_client_select on public.workout_exercises is 'Client can read exercise rows for any workout row they can already select (workouts RLS re-applies via the subselect).';

-- ---------------------------------------------------------------------------
-- programs
-- ---------------------------------------------------------------------------

alter table public.programs enable row level security;

create policy programs_coach_all
  on public.programs for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

comment on policy programs_coach_all on public.programs is 'Coach full CRUD on programs they authored.';

create policy programs_client_select
  on public.programs for select
  using (
    client_id = auth.uid()
    or exists (
      select 1 from public.assignments a
      where a.client_id = auth.uid() and a.program_id = programs.id
    )
  );

comment on policy programs_client_select on public.programs is 'Client can read a per-client copy of a program, or any program they have (or had) an assignment referencing.';

-- ---------------------------------------------------------------------------
-- program_phases (child of programs)
-- ---------------------------------------------------------------------------

alter table public.program_phases enable row level security;

create policy program_phases_coach_all
  on public.program_phases for all
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id and p.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id and p.created_by = auth.uid()
    )
  );

comment on policy program_phases_coach_all on public.program_phases is 'Coach full CRUD on phases of programs they own.';

create policy program_phases_client_select
  on public.program_phases for select
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id
        and (
          p.client_id = auth.uid()
          or exists (
            select 1 from public.assignments a
            where a.client_id = auth.uid() and a.program_id = p.id
          )
        )
    )
  );

comment on policy program_phases_client_select on public.program_phases is 'Client can read phases of any program they can read.';

-- ---------------------------------------------------------------------------
-- week_schedules (child of programs/program_phases)
-- ---------------------------------------------------------------------------

alter table public.week_schedules enable row level security;

create policy week_schedules_coach_all
  on public.week_schedules for all
  using (
    exists (
      select 1 from public.programs p
      where p.id = week_schedules.program_id and p.created_by = auth.uid()
    )
    or exists (
      select 1 from public.program_phases ph
      join public.programs p on p.id = ph.program_id
      where ph.id = week_schedules.phase_id and p.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = week_schedules.program_id and p.created_by = auth.uid()
    )
    or exists (
      select 1 from public.program_phases ph
      join public.programs p on p.id = ph.program_id
      where ph.id = week_schedules.phase_id and p.created_by = auth.uid()
    )
  );

comment on policy week_schedules_coach_all on public.week_schedules is 'Coach full CRUD on schedule rows scoped to a program or phase they own.';

create policy week_schedules_client_select
  on public.week_schedules for select
  using (
    exists (
      select 1 from public.programs p
      where p.id = week_schedules.program_id
        and (
          p.client_id = auth.uid()
          or exists (
            select 1 from public.assignments a
            where a.client_id = auth.uid() and a.program_id = p.id
          )
        )
    )
    or exists (
      select 1 from public.program_phases ph
      join public.programs p on p.id = ph.program_id
      where ph.id = week_schedules.phase_id
        and (
          p.client_id = auth.uid()
          or exists (
            select 1 from public.assignments a
            where a.client_id = auth.uid() and a.program_id = p.id
          )
        )
    )
  );

comment on policy week_schedules_client_select on public.week_schedules is 'Client can read schedule rows belonging to any program (directly or via a phase) they can read.';

-- ---------------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------------

alter table public.assignments enable row level security;

create policy assignments_coach_all
  on public.assignments for all
  using (public.is_coach_of(client_id))
  with check (public.is_coach_of(client_id));

comment on policy assignments_coach_all on public.assignments is 'Coach full CRUD on assignments for their own clients.';

create policy assignments_client_select
  on public.assignments for select
  using (client_id = auth.uid());

comment on policy assignments_client_select on public.assignments is 'Client can read their own assignments.';

-- ---------------------------------------------------------------------------
-- assignment_date_overrides (child of assignments)
-- ---------------------------------------------------------------------------

alter table public.assignment_date_overrides enable row level security;

create policy assignment_date_overrides_coach_all
  on public.assignment_date_overrides for all
  using (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_date_overrides.assignment_id and public.is_coach_of(a.client_id)
    )
  )
  with check (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_date_overrides.assignment_id and public.is_coach_of(a.client_id)
    )
  );

comment on policy assignment_date_overrides_coach_all on public.assignment_date_overrides is 'Coach full CRUD on date overrides belonging to their own clients'' assignments.';

create policy assignment_date_overrides_client_select
  on public.assignment_date_overrides for select
  using (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_date_overrides.assignment_id and a.client_id = auth.uid()
    )
  );

comment on policy assignment_date_overrides_client_select on public.assignment_date_overrides is 'Client can read date overrides on their own assignments.';
