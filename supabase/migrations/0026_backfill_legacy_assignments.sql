-- Backfill: convert pre-0020 assignments from templates to instances.
--
-- 0020 changed assign_program to deep-copy, but never converted assignments
-- that already existed. Those still point at a library template
-- (programs.client_id IS NULL), so every client sharing a program shares one
-- set of rows — the exact B1/B2 bug 0020 exists to prevent. A coach editing
-- one client's Tuesday still reshuffles everyone's.
--
-- Each legacy assignment gets its own deep copy, then is repointed at it.
-- copy_program_tree (not assign_program) because assign_program gates on
-- is_coach_of() -> auth.uid(), which is null during a migration; its comment
-- sanctions this path. Ordering logic in assign_program is not needed: this
-- repoints existing rows without changing which assignment is active.
--
-- workout_logs are untouched. workout_logs.workout_id is a provenance
-- pointer (data-model.md tier 3 / R4 "set null"), and history renders from
-- the log's own snapshot, so leaving logs pointed at the old template row
-- changes nothing a client or coach sees.
--
-- Idempotent: selects only rows still pointing at a template, so a re-run
-- after a successful run matches nothing.

do $$
declare
  r record;
  v_instance_id uuid;
begin
  for r in
    select a.id, a.client_id, a.program_id
    from public.assignments a
    join public.programs p on p.id = a.program_id
    where p.client_id is null
  loop
    v_instance_id := public.copy_program_tree(r.program_id, r.client_id, null);
    update public.assignments set program_id = v_instance_id where id = r.id;
    raise notice 'assignment %: template % -> instance %', r.id, r.program_id, v_instance_id;
  end loop;
end $$;
