-- Wave 2.5: fix Supabase security-advisor WARN findings against 0005-0008
-- (already applied remotely). Pure forward fixes only — never edit applied
-- migration files.
--
-- 1. function_search_path_mutable: pin search_path on set_updated_at().
-- 2. Revoke EXECUTE on trigger-only functions from all API roles.
-- 3. Tighten helper EXECUTE grants: drop public/anon, keep authenticated.
-- 4. auth_rls_initplan: wrap every bare auth.uid() in a policy qual/check
--    with (select auth.uid()) so it's evaluated once per statement instead
--    of once per row. No semantic changes — same predicates, same policy
--    names, drop + recreate only.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on set_updated_at()
-- ---------------------------------------------------------------------------

alter function public.set_updated_at() set search_path = '';

-- is_coach(), is_coach_of(uuid), and prevent_profile_privilege_change()
-- already declare `set search_path = ''` at creation time (0005) — nothing
-- to fix there.

-- ---------------------------------------------------------------------------
-- 2. Revoke EXECUTE on trigger-only functions
-- ---------------------------------------------------------------------------

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.prevent_profile_privilege_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tighten helper EXECUTE grants (keep authenticated — RLS policies call
--    these as the requesting role)
-- ---------------------------------------------------------------------------

revoke execute on function public.is_coach() from public, anon;
revoke execute on function public.is_coach_of(uuid) from public, anon;
grant execute on function public.is_coach() to authenticated;
grant execute on function public.is_coach_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. auth_rls_initplan: recreate every affected policy with
--    (select auth.uid()) in place of bare auth.uid(). Same names, same
--    semantics, drop + create only.
-- ---------------------------------------------------------------------------

-- profiles

drop policy profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  using (id = (select auth.uid()));

drop policy profiles_select_own_clients on public.profiles;
create policy profiles_select_own_clients
  on public.profiles for select
  using (invited_by = (select auth.uid()));

drop policy profiles_select_own_coach on public.profiles;
create policy profiles_select_own_coach
  on public.profiles for select
  using (id = (select invited_by from public.profiles where id = (select auth.uid())));

drop policy profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy profiles_update_own_clients on public.profiles;
create policy profiles_update_own_clients
  on public.profiles for update
  using (invited_by = (select auth.uid()))
  with check (invited_by = (select auth.uid()));

-- exercises

drop policy exercises_coach_all on public.exercises;
create policy exercises_coach_all
  on public.exercises for all
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

drop policy exercises_client_select on public.exercises;
create policy exercises_client_select
  on public.exercises for select
  using (
    created_by = (select invited_by from public.profiles where id = (select auth.uid()))
  );

-- workouts

drop policy workouts_coach_all on public.workouts;
create policy workouts_coach_all
  on public.workouts for all
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

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
    or id in (select warmup_id from public.workouts w2 where w2.client_id = (select auth.uid()))
  );

-- workout_exercises

drop policy workout_exercises_coach_all on public.workout_exercises;
create policy workout_exercises_coach_all
  on public.workout_exercises for all
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_exercises.workout_id and w.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_exercises.workout_id and w.created_by = (select auth.uid())
    )
  );

-- workout_exercises_client_select has no bare auth.uid() (its subselect only
-- checks existence of the workout row); left unchanged.

-- programs

drop policy programs_coach_all on public.programs;
create policy programs_coach_all
  on public.programs for all
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

drop policy programs_client_select on public.programs;
create policy programs_client_select
  on public.programs for select
  using (
    client_id = (select auth.uid())
    or exists (
      select 1 from public.assignments a
      where a.client_id = (select auth.uid()) and a.program_id = programs.id
    )
  );

-- program_phases

drop policy program_phases_coach_all on public.program_phases;
create policy program_phases_coach_all
  on public.program_phases for all
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id and p.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id and p.created_by = (select auth.uid())
    )
  );

drop policy program_phases_client_select on public.program_phases;
create policy program_phases_client_select
  on public.program_phases for select
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_phases.program_id
        and (
          p.client_id = (select auth.uid())
          or exists (
            select 1 from public.assignments a
            where a.client_id = (select auth.uid()) and a.program_id = p.id
          )
        )
    )
  );

-- week_schedules

drop policy week_schedules_coach_all on public.week_schedules;
create policy week_schedules_coach_all
  on public.week_schedules for all
  using (
    exists (
      select 1 from public.programs p
      where p.id = week_schedules.program_id and p.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.program_phases ph
      join public.programs p on p.id = ph.program_id
      where ph.id = week_schedules.phase_id and p.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = week_schedules.program_id and p.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.program_phases ph
      join public.programs p on p.id = ph.program_id
      where ph.id = week_schedules.phase_id and p.created_by = (select auth.uid())
    )
  );

drop policy week_schedules_client_select on public.week_schedules;
create policy week_schedules_client_select
  on public.week_schedules for select
  using (
    exists (
      select 1 from public.programs p
      where p.id = week_schedules.program_id
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
      where ph.id = week_schedules.phase_id
        and (
          p.client_id = (select auth.uid())
          or exists (
            select 1 from public.assignments a
            where a.client_id = (select auth.uid()) and a.program_id = p.id
          )
        )
    )
  );

-- assignments (coach policy uses is_coach_of(), no bare auth.uid())

drop policy assignments_client_select on public.assignments;
create policy assignments_client_select
  on public.assignments for select
  using (client_id = (select auth.uid()));

-- assignment_date_overrides

drop policy assignment_date_overrides_client_select on public.assignment_date_overrides;
create policy assignment_date_overrides_client_select
  on public.assignment_date_overrides for select
  using (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_date_overrides.assignment_id and a.client_id = (select auth.uid())
    )
  );

-- assignment_date_overrides_coach_all uses only is_coach_of(); unchanged.

-- workout_logs

drop policy workout_logs_client_crud on public.workout_logs;
create policy workout_logs_client_crud
  on public.workout_logs for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

-- workout_logs_coach_select uses only is_coach_of(); unchanged.

-- exercise_logs

drop policy exercise_logs_client_crud on public.exercise_logs;
create policy exercise_logs_client_crud
  on public.exercise_logs for all
  using (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = exercise_logs.workout_log_id and wl.client_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = exercise_logs.workout_log_id and wl.client_id = (select auth.uid())
    )
  );

-- exercise_logs_coach_select uses only is_coach_of(); unchanged.

-- set_logs

drop policy set_logs_client_crud on public.set_logs;
create policy set_logs_client_crud
  on public.set_logs for all
  using (
    exists (
      select 1 from public.exercise_logs el
      join public.workout_logs wl on wl.id = el.workout_log_id
      where el.id = set_logs.exercise_log_id and wl.client_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.exercise_logs el
      join public.workout_logs wl on wl.id = el.workout_log_id
      where el.id = set_logs.exercise_log_id and wl.client_id = (select auth.uid())
    )
  );

-- set_logs_coach_select uses only is_coach_of(); unchanged.

-- goals (goals_coach_all uses only is_coach_of(); unchanged)

drop policy goals_client_select on public.goals;
create policy goals_client_select
  on public.goals for select
  using (client_id = (select auth.uid()));

drop policy goals_client_insert on public.goals;
create policy goals_client_insert
  on public.goals for insert
  with check (client_id = (select auth.uid()) and set_by = (select auth.uid()) and locked = false);

drop policy goals_client_update on public.goals;
create policy goals_client_update
  on public.goals for update
  using (client_id = (select auth.uid()) and locked = false);

-- goal_logs (goal_logs_coach_select uses only is_coach_of(); unchanged)

drop policy goal_logs_client_crud on public.goal_logs;
create policy goal_logs_client_crud
  on public.goal_logs for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

-- threads

drop policy threads_client_select on public.threads;
create policy threads_client_select
  on public.threads for select
  using (client_id = (select auth.uid()));

drop policy threads_client_update on public.threads;
create policy threads_client_update
  on public.threads for update
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

drop policy threads_client_insert on public.threads;
create policy threads_client_insert
  on public.threads for insert
  with check (
    client_id = (select auth.uid())
    and coach_id = (select invited_by from public.profiles where id = (select auth.uid()))
  );

drop policy threads_coach_select on public.threads;
create policy threads_coach_select
  on public.threads for select
  using (coach_id = (select auth.uid()));

drop policy threads_coach_update on public.threads;
create policy threads_coach_update
  on public.threads for update
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

drop policy threads_coach_insert on public.threads;
create policy threads_coach_insert
  on public.threads for insert
  with check (coach_id = (select auth.uid()) and public.is_coach_of(client_id));

-- messages

drop policy messages_select_participants on public.messages;
create policy messages_select_participants
  on public.messages for select
  using (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.client_id = (select auth.uid()) or t.coach_id = (select auth.uid()))
    )
  );

drop policy messages_insert_participants on public.messages;
create policy messages_insert_participants
  on public.messages for insert
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.client_id = (select auth.uid()) or t.coach_id = (select auth.uid()))
    )
  );

drop policy messages_update_participants on public.messages;
create policy messages_update_participants
  on public.messages for update
  using (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.client_id = (select auth.uid()) or t.coach_id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.client_id = (select auth.uid()) or t.coach_id = (select auth.uid()))
    )
  );

-- friendships

drop policy friendships_select_members on public.friendships;
create policy friendships_select_members
  on public.friendships for select
  using (
    (select auth.uid()) in (client_id, friend_id)
    or coach_id = (select auth.uid())
  );

drop policy friendships_client_insert on public.friendships;
create policy friendships_client_insert
  on public.friendships for insert
  with check (
    requested_by = (select auth.uid())
    and (select auth.uid()) in (client_id, friend_id)
    and status = 'pending'
    and exists (
      select 1
      from public.profiles a, public.profiles b
      where a.id = client_id
        and b.id = friend_id
        and a.invited_by is not null
        and a.invited_by = b.invited_by
        and coach_id = a.invited_by
    )
  );

drop policy friendships_client_update on public.friendships;
create policy friendships_client_update
  on public.friendships for update
  using (
    (select auth.uid()) in (client_id, friend_id)
    and status = 'pending'
  )
  with check (
    status = 'accepted'
    and requested_by <> (select auth.uid())
  );

drop policy friendships_delete_members on public.friendships;
create policy friendships_delete_members
  on public.friendships for delete
  using (
    (select auth.uid()) in (client_id, friend_id)
    or coach_id = (select auth.uid())
  );

-- change_requests

drop policy change_requests_client_insert on public.change_requests;
create policy change_requests_client_insert
  on public.change_requests for insert
  with check (
    client_id = (select auth.uid())
    and coach_id = (select invited_by from public.profiles where id = (select auth.uid()))
    and status = 'pending'
  );

drop policy change_requests_client_select on public.change_requests;
create policy change_requests_client_select
  on public.change_requests for select
  using (client_id = (select auth.uid()));

drop policy change_requests_coach_select on public.change_requests;
create policy change_requests_coach_select
  on public.change_requests for select
  using (coach_id = (select auth.uid()));

-- progress_photos (progress_photos_coach_select uses only is_coach_of(); unchanged)

drop policy progress_photos_client_crud on public.progress_photos;
create policy progress_photos_client_crud
  on public.progress_photos for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

-- body_measurements (body_measurements_coach_select uses only is_coach_of(); unchanged)

drop policy body_measurements_client_crud on public.body_measurements;
create policy body_measurements_client_crud
  on public.body_measurements for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

-- motivation_entries

drop policy motivation_entries_coach_all on public.motivation_entries;
create policy motivation_entries_coach_all
  on public.motivation_entries for all
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

drop policy motivation_entries_client_select on public.motivation_entries;
create policy motivation_entries_client_select
  on public.motivation_entries for select
  using (
    created_by = (select invited_by from public.profiles where id = (select auth.uid()))
  );

-- client_summaries

drop policy client_summaries_coach_select on public.client_summaries;
create policy client_summaries_coach_select
  on public.client_summaries for select
  using (coach_id = (select auth.uid()));

drop policy client_summaries_client_select on public.client_summaries;
create policy client_summaries_client_select
  on public.client_summaries for select
  using (client_id = (select auth.uid()));

-- storage.objects (exercise-demos, motivation-images, progress-photos)

drop policy exercise_demos_coach_insert on storage.objects;
create policy exercise_demos_coach_insert
  on storage.objects for insert
  with check (
    bucket_id = 'exercise-demos'
    and owner = (select auth.uid())
    and public.is_coach()
  );

drop policy exercise_demos_coach_update on storage.objects;
create policy exercise_demos_coach_update
  on storage.objects for update
  using (bucket_id = 'exercise-demos' and owner = (select auth.uid()) and public.is_coach())
  with check (bucket_id = 'exercise-demos' and owner = (select auth.uid()) and public.is_coach());

drop policy exercise_demos_coach_delete on storage.objects;
create policy exercise_demos_coach_delete
  on storage.objects for delete
  using (bucket_id = 'exercise-demos' and owner = (select auth.uid()) and public.is_coach());

-- exercise_demos_authenticated_select uses auth.role(), not auth.uid(); left
-- as-is per scope (auth.role() re-evaluation is a separate advisor finding,
-- not covered by this migration's instructions).

drop policy motivation_images_coach_insert on storage.objects;
create policy motivation_images_coach_insert
  on storage.objects for insert
  with check (
    bucket_id = 'motivation-images'
    and owner = (select auth.uid())
    and public.is_coach()
  );

drop policy motivation_images_coach_update on storage.objects;
create policy motivation_images_coach_update
  on storage.objects for update
  using (bucket_id = 'motivation-images' and owner = (select auth.uid()) and public.is_coach())
  with check (bucket_id = 'motivation-images' and owner = (select auth.uid()) and public.is_coach());

drop policy motivation_images_coach_delete on storage.objects;
create policy motivation_images_coach_delete
  on storage.objects for delete
  using (bucket_id = 'motivation-images' and owner = (select auth.uid()) and public.is_coach());

-- motivation_images_authenticated_select uses auth.role(); left as-is, same
-- reasoning as exercise_demos_authenticated_select above.

drop policy progress_photos_client_insert on storage.objects;
create policy progress_photos_client_insert
  on storage.objects for insert
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy progress_photos_client_select on storage.objects;
create policy progress_photos_client_select
  on storage.objects for select
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy progress_photos_client_delete on storage.objects;
create policy progress_photos_client_delete
  on storage.objects for delete
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- progress_photos_coach_select uses only is_coach_of(); unchanged.
