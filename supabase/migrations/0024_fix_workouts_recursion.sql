-- workouts_client_select subqueried workouts inside a workouts policy,
-- which re-triggers RLS on the same table: 42P17 infinite recursion for every
-- authenticated SELECT (including coach library lists). Route the warmup lookup
-- through a SECURITY DEFINER helper (bypasses RLS, safe: returns only warmup
-- ids attached to the caller's own client_id-stamped workouts).

create or replace function public.my_client_warmup_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select warmup_id
  from public.workouts
  where client_id = auth.uid()
    and warmup_id is not null;
$$;

comment on function public.my_client_warmup_ids() is
  'Warmup ids linked from the caller''s own client-scoped workouts. Used by workouts_client_select so the policy does not self-select workouts (42P17).';

revoke execute on function public.my_client_warmup_ids() from public, anon;
grant execute on function public.my_client_warmup_ids() to authenticated;

drop policy workouts_client_select on public.workouts;
create policy workouts_client_select
  on public.workouts for select
  using (
    client_id = (select auth.uid())
    or exists (
      select 1
      from public.assignments a
      join public.week_schedules ws
        on ws.program_id = a.program_id
        or ws.phase_id in (select id from public.program_phases where program_id = a.program_id)
      where a.client_id = (select auth.uid())
        and a.active
        and ws.workout_id = workouts.id
    )
    or exists (
      select 1
      from public.assignment_date_overrides ado
      join public.assignments a on a.id = ado.assignment_id
      where a.client_id = (select auth.uid())
        and ado.workout_id = workouts.id
    )
    or id in (select public.my_client_warmup_ids())
  );

comment on policy workouts_client_select on public.workouts is
  'Client can read a per-client copy of a workout, or any workout reachable from their active assignment''s program tree (scheduled or via a date override), or the warmup attached to a workout they own (via my_client_warmup_ids — no self-select on workouts).';
