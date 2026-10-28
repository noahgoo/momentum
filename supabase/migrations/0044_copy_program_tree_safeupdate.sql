-- ---------------------------------------------------------------------------
-- 0044: copy_program_tree must not issue a WHERE-less DELETE.
--
-- Hosted Supabase loads pg_safeupdate for API roles, which rejects any
-- DELETE without a WHERE clause ("DELETE requires a WHERE clause"). The temp
-- map tables were cleared with a bare `delete from _phase_map;` and
-- `delete from _session_map;`, so assign_program failed on hosted projects.
-- Local Postgres does not load the extension, which is why it never failed
-- in tests or seed.
--
-- Body is 0034's, unchanged except those two statements now carry
-- `where true`.
-- ---------------------------------------------------------------------------

create or replace function public.copy_program_tree(
  p_program_id uuid,
  p_client_id uuid,
  p_name_suffix text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.programs%rowtype;
  v_new_program_id uuid;
begin
  select * into v_source from public.programs where id = p_program_id;
  if v_source.id is null then
    raise exception 'program_not_found';
  end if;

  insert into public.programs (name, description, weeks, created_by, client_id)
  values (
    v_source.name || coalesce(p_name_suffix, ''),
    v_source.description,
    v_source.weeks,
    v_source.created_by,
    p_client_id
  )
  returning id into v_new_program_id;

  -- Phases, keeping a map from old id to new so phase-scoped sessions can be
  -- remapped. Joined back on sort_order, which is unique within a program.
  create temp table if not exists _phase_map (old_id uuid, new_id uuid) on commit drop;
  delete from _phase_map where true;

  with inserted as (
    insert into public.program_phases (program_id, name, sort_order, weeks, active_days)
    select v_new_program_id, ph.name, ph.sort_order, ph.weeks, ph.active_days
    from public.program_phases ph
    where ph.program_id = p_program_id
    returning id, sort_order
  )
  insert into _phase_map (old_id, new_id)
  select ph.id, i.id
  from public.program_phases ph
  join inserted i on i.sort_order = ph.sort_order
  where ph.program_id = p_program_id;

  -- Sessions, with a map of their own so their exercises can follow. Each
  -- one carries its snapshotted display fields across unchanged: the copy is
  -- of what the source session SAYS, so a coach's edit to a template day
  -- reaches the client they assign it to next, and no one already assigned.
  create temp table if not exists _session_map (old_id uuid, new_id uuid) on commit drop;
  delete from _session_map where true;

  declare
    v_session record;
    v_new_session_id uuid;
  begin
    for v_session in
      select s.*
      from public.sessions s
      left join public.program_phases ph on ph.id = s.phase_id
      where s.program_id = p_program_id or ph.program_id = p_program_id
    loop
      insert into public.sessions (
        program_id, phase_id, week_number, day_of_week,
        source_workout_id, name, description, estimated_duration_minutes, equipment,
        warmup_name, warmup_source_workout_id
      )
      values (
        case when v_session.program_id is not null then v_new_program_id else null end,
        (select new_id from _phase_map where old_id = v_session.phase_id),
        v_session.week_number,
        v_session.day_of_week,
        v_session.source_workout_id,
        v_session.name,
        v_session.description,
        v_session.estimated_duration_minutes,
        v_session.equipment,
        v_session.warmup_name,
        v_session.warmup_source_workout_id
      )
      returning id into v_new_session_id;

      insert into _session_map (old_id, new_id) values (v_session.id, v_new_session_id);
    end loop;
  end;

  -- `exercises` is shared reference data (name, video, defaults) and is NOT
  -- copied — the copies keep FKing into the same library rows.
  insert into public.session_exercises (
    session_id, section, exercise_id, sort_order, mode, set_configs, rest_seconds, notes
  )
  select m.new_id, se.section, se.exercise_id, se.sort_order, se.mode,
         se.set_configs, se.rest_seconds, se.notes
  from public.session_exercises se
  join _session_map m on m.old_id = se.session_id;

  return v_new_program_id;
end;
$$;

comment on function public.copy_program_tree(uuid, uuid, text) is
  'Deep-copies a program for one client: the program, its phases, its sessions and their exercise rows. Writes NO workouts rows — sessions are already the per-client copy, so the library is untouched by an assign. `exercises` is shared reference data and is not copied. Internal: called by assign_program and duplicate_program only.';
