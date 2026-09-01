-- Wave 2.2: RLS on logging, goals, messaging, and social tables.
-- workout_logs, exercise_logs, set_logs, goals, goal_logs, threads, messages,
-- friendships, change_requests, progress_photos, body_measurements,
-- motivation_entries, client_summaries.

-- ---------------------------------------------------------------------------
-- workout_logs
-- ---------------------------------------------------------------------------

alter table public.workout_logs enable row level security;

create policy workout_logs_client_crud
  on public.workout_logs for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

comment on policy workout_logs_client_crud on public.workout_logs is 'Client full CRUD on their own workout logs.';

create policy workout_logs_coach_select
  on public.workout_logs for select
  using (public.is_coach_of(client_id));

comment on policy workout_logs_coach_select on public.workout_logs is 'Coach can read workout logs of their own clients.';

-- ---------------------------------------------------------------------------
-- exercise_logs (child of workout_logs)
-- ---------------------------------------------------------------------------

alter table public.exercise_logs enable row level security;

create policy exercise_logs_client_crud
  on public.exercise_logs for all
  using (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = exercise_logs.workout_log_id and wl.client_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = exercise_logs.workout_log_id and wl.client_id = auth.uid()
    )
  );

comment on policy exercise_logs_client_crud on public.exercise_logs is 'Client full CRUD on exercise logs under their own workout logs.';

create policy exercise_logs_coach_select
  on public.exercise_logs for select
  using (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = exercise_logs.workout_log_id and public.is_coach_of(wl.client_id)
    )
  );

comment on policy exercise_logs_coach_select on public.exercise_logs is 'Coach can read exercise logs belonging to their own clients.';

-- ---------------------------------------------------------------------------
-- set_logs (child of exercise_logs)
-- ---------------------------------------------------------------------------

alter table public.set_logs enable row level security;

create policy set_logs_client_crud
  on public.set_logs for all
  using (
    exists (
      select 1 from public.exercise_logs el
      join public.workout_logs wl on wl.id = el.workout_log_id
      where el.id = set_logs.exercise_log_id and wl.client_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.exercise_logs el
      join public.workout_logs wl on wl.id = el.workout_log_id
      where el.id = set_logs.exercise_log_id and wl.client_id = auth.uid()
    )
  );

comment on policy set_logs_client_crud on public.set_logs is 'Client full CRUD on set logs under their own exercise logs.';

create policy set_logs_coach_select
  on public.set_logs for select
  using (
    exists (
      select 1 from public.exercise_logs el
      join public.workout_logs wl on wl.id = el.workout_log_id
      where el.id = set_logs.exercise_log_id and public.is_coach_of(wl.client_id)
    )
  );

comment on policy set_logs_coach_select on public.set_logs is 'Coach can read set logs belonging to their own clients.';

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------

alter table public.goals enable row level security;

create policy goals_coach_all
  on public.goals for all
  using (public.is_coach_of(client_id))
  with check (public.is_coach_of(client_id));

comment on policy goals_coach_all on public.goals is 'Coach full CRUD on goals for their own clients.';

create policy goals_client_select
  on public.goals for select
  using (client_id = auth.uid());

comment on policy goals_client_select on public.goals is 'Client can read their own goals.';

create policy goals_client_insert
  on public.goals for insert
  with check (client_id = auth.uid() and set_by = auth.uid() and locked = false);

comment on policy goals_client_insert on public.goals is 'Client can create their own goals; cannot self-assign locked = true or attribute authorship to someone else.';

create policy goals_client_update
  on public.goals for update
  using (client_id = auth.uid() and locked = false);

comment on policy goals_client_update on public.goals is 'Client can update (e.g. archive) their own goals only while unlocked. No client hard DELETE policy exists.';

-- ---------------------------------------------------------------------------
-- goal_logs
-- ---------------------------------------------------------------------------

alter table public.goal_logs enable row level security;

create policy goal_logs_client_crud
  on public.goal_logs for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

comment on policy goal_logs_client_crud on public.goal_logs is 'Client full CRUD on their own goal logs.';

create policy goal_logs_coach_select
  on public.goal_logs for select
  using (public.is_coach_of(client_id));

comment on policy goal_logs_coach_select on public.goal_logs is 'Coach can read goal logs of their own clients.';

-- ---------------------------------------------------------------------------
-- threads
-- ---------------------------------------------------------------------------

alter table public.threads enable row level security;

create policy threads_client_select
  on public.threads for select
  using (client_id = auth.uid());

comment on policy threads_client_select on public.threads is 'Client can read their own thread.';

create policy threads_client_update
  on public.threads for update
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

comment on policy threads_client_update on public.threads is 'Client can update their own thread (e.g. mark read).';

create policy threads_client_insert
  on public.threads for insert
  with check (
    client_id = auth.uid()
    and coach_id = (select invited_by from public.profiles where id = auth.uid())
  );

comment on policy threads_client_insert on public.threads is 'Client can create their own thread, only paired with their actual coach.';

create policy threads_coach_select
  on public.threads for select
  using (coach_id = auth.uid());

comment on policy threads_coach_select on public.threads is 'Coach can read threads where they are the coach party.';

create policy threads_coach_update
  on public.threads for update
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

comment on policy threads_coach_update on public.threads is 'Coach can update threads where they are the coach party (e.g. mark read).';

create policy threads_coach_insert
  on public.threads for insert
  with check (coach_id = auth.uid() and public.is_coach_of(client_id));

comment on policy threads_coach_insert on public.threads is 'Coach can create a thread with one of their own clients.';

-- ---------------------------------------------------------------------------
-- messages (participants only)
-- ---------------------------------------------------------------------------

alter table public.messages enable row level security;

create policy messages_select_participants
  on public.messages for select
  using (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.client_id = auth.uid() or t.coach_id = auth.uid())
    )
  );

comment on policy messages_select_participants on public.messages is 'Either participant (client or coach) of the thread can read its messages.';

create policy messages_insert_participants
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.client_id = auth.uid() or t.coach_id = auth.uid())
    )
  );

comment on policy messages_insert_participants on public.messages is 'A participant can send a message into their own thread; sender_id must match the caller.';

create policy messages_update_participants
  on public.messages for update
  using (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.client_id = auth.uid() or t.coach_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.client_id = auth.uid() or t.coach_id = auth.uid())
    )
  );

comment on policy messages_update_participants on public.messages is 'Either participant can update a message in their thread (e.g. flip the read flag).';

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------

alter table public.friendships enable row level security;

-- shared_streak/stats/stats_updated_at are intended to be trigger-maintained
-- (Wave 3 recompute_friendship_stats()). Client insert/update policies below
-- don't attempt to lock those columns down at the RLS layer; trigger
-- discipline in Wave 3 is what actually keeps them authoritative.

create policy friendships_select_members
  on public.friendships for select
  using (
    auth.uid() in (client_id, friend_id)
    or coach_id = auth.uid()
  );

comment on policy friendships_select_members on public.friendships is 'Either member of the friendship, or the shared coach, can read it.';

create policy friendships_client_insert
  on public.friendships for insert
  with check (
    requested_by = auth.uid()
    and auth.uid() in (client_id, friend_id)
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

comment on policy friendships_client_insert on public.friendships is 'A client can request a friendship with another client sharing the same coach; requested_by must be the caller and the caller must be one of the two members.';

create policy friendships_client_update
  on public.friendships for update
  using (
    auth.uid() in (client_id, friend_id)
    and status = 'pending'
  )
  with check (
    status = 'accepted'
    and requested_by <> auth.uid()
  );

comment on policy friendships_client_update on public.friendships is 'The non-requesting member can accept a pending request; the requester cannot self-accept.';

create policy friendships_delete_members
  on public.friendships for delete
  using (
    auth.uid() in (client_id, friend_id)
    or coach_id = auth.uid()
  );

comment on policy friendships_delete_members on public.friendships is 'Either member, or the shared coach, can delete (unfriend) the pair.';

-- ---------------------------------------------------------------------------
-- change_requests
-- ---------------------------------------------------------------------------

alter table public.change_requests enable row level security;

create policy change_requests_client_insert
  on public.change_requests for insert
  with check (
    client_id = auth.uid()
    and coach_id = (select invited_by from public.profiles where id = auth.uid())
    and status = 'pending'
  );

comment on policy change_requests_client_insert on public.change_requests is 'Client can create a pending change request against their own coach.';

create policy change_requests_client_select
  on public.change_requests for select
  using (client_id = auth.uid());

comment on policy change_requests_client_select on public.change_requests is 'Client can read their own change requests.';

create policy change_requests_coach_select
  on public.change_requests for select
  using (coach_id = auth.uid());

comment on policy change_requests_coach_select on public.change_requests is 'Coach can read change requests addressed to them.';

-- Intentionally NO update/delete policies on change_requests: status
-- transitions (accept/reject) happen only via Wave 3 SECURITY DEFINER RPCs,
-- which bypass RLS entirely.

-- ---------------------------------------------------------------------------
-- progress_photos
-- ---------------------------------------------------------------------------

alter table public.progress_photos enable row level security;

create policy progress_photos_client_crud
  on public.progress_photos for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

comment on policy progress_photos_client_crud on public.progress_photos is 'Client full CRUD on their own progress photo metadata.';

create policy progress_photos_coach_select
  on public.progress_photos for select
  using (public.is_coach_of(client_id));

comment on policy progress_photos_coach_select on public.progress_photos is 'Coach can read progress photo metadata of their own clients.';

-- ---------------------------------------------------------------------------
-- body_measurements
-- ---------------------------------------------------------------------------

alter table public.body_measurements enable row level security;

create policy body_measurements_client_crud
  on public.body_measurements for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

comment on policy body_measurements_client_crud on public.body_measurements is 'Client full CRUD on their own body measurements.';

create policy body_measurements_coach_select
  on public.body_measurements for select
  using (public.is_coach_of(client_id));

comment on policy body_measurements_coach_select on public.body_measurements is 'Coach can read body measurements of their own clients.';

-- ---------------------------------------------------------------------------
-- motivation_entries
-- ---------------------------------------------------------------------------

alter table public.motivation_entries enable row level security;

create policy motivation_entries_coach_all
  on public.motivation_entries for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

comment on policy motivation_entries_coach_all on public.motivation_entries is 'Coach full CRUD on motivation entries they authored.';

create policy motivation_entries_client_select
  on public.motivation_entries for select
  using (
    created_by = (select invited_by from public.profiles where id = auth.uid())
  );

comment on policy motivation_entries_client_select on public.motivation_entries is 'Client can read motivation entries authored by their own coach.';

-- ---------------------------------------------------------------------------
-- client_summaries (select-only; trigger-written)
-- ---------------------------------------------------------------------------

alter table public.client_summaries enable row level security;

create policy client_summaries_coach_select
  on public.client_summaries for select
  using (coach_id = auth.uid());

comment on policy client_summaries_coach_select on public.client_summaries is 'Coach can read summary rows for their own clients.';

create policy client_summaries_client_select
  on public.client_summaries for select
  using (client_id = auth.uid());

comment on policy client_summaries_client_select on public.client_summaries is 'Client can read their own summary row.';

-- Intentionally NO insert/update/delete policies on client_summaries: it is
-- written only by Wave 3 SECURITY DEFINER triggers/functions, which bypass RLS.
