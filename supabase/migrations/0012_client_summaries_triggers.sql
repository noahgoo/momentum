-- Wave 3.3: client_summaries maintenance — refresh function + triggers on
-- every table that can change a client's dashboard rollup (assignments,
-- workout_logs, goals, goal_logs, threads, profiles).

-- ---------------------------------------------------------------------------
-- refresh_client_summary: upsert (or delete) one client's summary row
-- ---------------------------------------------------------------------------

create function public.refresh_client_summary(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_today date;
  v_today_workout_id uuid;
  v_today_workout_name text;
  v_workout_done boolean;
  v_has_program boolean;
  v_active_goal_count int;
  v_goals_completed_today int;
  v_streak int;
  v_unread_for_coach boolean;
  v_last_message_at timestamptz;
begin
  select * into v_profile from public.profiles where id = p_client_id;

  -- Client deleted, or no longer a client (e.g. role changed) — the summary
  -- row no longer applies.
  if v_profile.id is null or v_profile.role <> 'client' then
    delete from public.client_summaries where client_id = p_client_id;
    return;
  end if;

  v_today := public.client_today(p_client_id);

  select exists (
    select 1 from public.assignments a where a.client_id = p_client_id and a.active
  ) into v_has_program;

  v_today_workout_id := public.resolve_scheduled_workout(p_client_id, v_today);

  select w.name into v_today_workout_name
  from public.workouts w
  where w.id = v_today_workout_id;

  select exists (
    select 1 from public.workout_logs wl
    where wl.client_id = p_client_id and wl.date = v_today and wl.completed
  ) into v_workout_done;

  select count(*) into v_active_goal_count
  from public.goals g
  where g.client_id = p_client_id and g.active;

  select count(*) into v_goals_completed_today
  from public.goal_logs gl
  where gl.client_id = p_client_id and gl.date = v_today;

  v_streak := public.compute_streak(p_client_id, v_today);

  select t.unread_for_coach, t.last_message_at
  into v_unread_for_coach, v_last_message_at
  from public.threads t
  where t.client_id = p_client_id;

  insert into public.client_summaries (
    client_id, coach_id, display_name, email, disabled,
    has_program, today_workout_name, workout_done,
    active_goal_count, goals_completed_today, streak,
    unread_for_coach, last_message_at, updated_at
  ) values (
    p_client_id, v_profile.invited_by, v_profile.display_name, v_profile.email, v_profile.disabled,
    v_has_program, v_today_workout_name, coalesce(v_workout_done, false),
    coalesce(v_active_goal_count, 0), coalesce(v_goals_completed_today, 0), coalesce(v_streak, 0),
    coalesce(v_unread_for_coach, false), v_last_message_at, now()
  )
  on conflict (client_id) do update set
    coach_id = excluded.coach_id,
    display_name = excluded.display_name,
    email = excluded.email,
    disabled = excluded.disabled,
    has_program = excluded.has_program,
    today_workout_name = excluded.today_workout_name,
    workout_done = excluded.workout_done,
    active_goal_count = excluded.active_goal_count,
    goals_completed_today = excluded.goals_completed_today,
    streak = excluded.streak,
    unread_for_coach = excluded.unread_for_coach,
    last_message_at = excluded.last_message_at,
    updated_at = now();
end;
$$;

comment on function public.refresh_client_summary(uuid) is
  'Recomputes and upserts one client''s client_summaries row from current data; deletes the row if the profile is gone or is no longer a client. Trigger- and cron-driven only — never called by application code directly.';

revoke execute on function public.refresh_client_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- refresh_all_client_summaries: full rebuild (daily cron)
-- ---------------------------------------------------------------------------

create function public.refresh_all_client_summaries()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  for v_client_id in select id from public.profiles where role = 'client' loop
    perform public.refresh_client_summary(v_client_id);
  end loop;
end;
$$;

comment on function public.refresh_all_client_summaries() is
  'Rebuilds every client''s client_summaries row. Run daily via pg_cron so summaries reflect week rollover / date changes even without a write.';

revoke execute on function public.refresh_all_client_summaries() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: refresh the affected client's summary on any relevant write.
-- Guarded against recursion by construction — these triggers only read from
-- their source tables and write to client_summaries, never back to
-- themselves or each other.
-- ---------------------------------------------------------------------------

create function public.trg_refresh_client_summary_by_client_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_client_summary(old.client_id);
    return old;
  end if;
  perform public.refresh_client_summary(new.client_id);
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    perform public.refresh_client_summary(old.client_id);
  end if;
  return new;
end;
$$;

comment on function public.trg_refresh_client_summary_by_client_id() is
  'Generic AFTER INSERT/UPDATE/DELETE trigger body for any table with a client_id column: refreshes that client''s summary (and the old client''s, if client_id changed on UPDATE).';

revoke execute on function public.trg_refresh_client_summary_by_client_id() from public, anon, authenticated;

create trigger refresh_client_summary_on_assignments
  after insert or update or delete on public.assignments
  for each row
  execute function public.trg_refresh_client_summary_by_client_id();

create trigger refresh_client_summary_on_workout_logs
  after insert or update or delete on public.workout_logs
  for each row
  execute function public.trg_refresh_client_summary_by_client_id();

create trigger refresh_client_summary_on_goals
  after insert or update or delete on public.goals
  for each row
  execute function public.trg_refresh_client_summary_by_client_id();

create trigger refresh_client_summary_on_goal_logs
  after insert or update or delete on public.goal_logs
  for each row
  execute function public.trg_refresh_client_summary_by_client_id();

create trigger refresh_client_summary_on_threads
  after insert or update or delete on public.threads
  for each row
  execute function public.trg_refresh_client_summary_by_client_id();

-- profiles is keyed by id, not client_id — its own trigger body refreshes
-- the row's own id (only relevant fields: role/name/disabled/invited_by).
create function public.trg_refresh_client_summary_on_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_client_summary(old.id);
    return old;
  end if;

  if tg_op = 'UPDATE'
    and new.role is not distinct from old.role
    and new.display_name is not distinct from old.display_name
    and new.disabled is not distinct from old.disabled
    and new.invited_by is not distinct from old.invited_by
    and new.email is not distinct from old.email
  then
    -- No summary-relevant column changed; skip the refresh.
    return new;
  end if;

  perform public.refresh_client_summary(new.id);
  return new;
end;
$$;

comment on function public.trg_refresh_client_summary_on_profiles() is
  'AFTER INSERT/UPDATE/DELETE on profiles: refreshes the row''s own client_summary when role/name/disabled/invited_by/email changes (a role flip or coach reassignment affects which coach sees the summary, or whether one exists at all).';

revoke execute on function public.trg_refresh_client_summary_on_profiles() from public, anon, authenticated;

create trigger refresh_client_summary_on_profiles
  after insert or update or delete on public.profiles
  for each row
  execute function public.trg_refresh_client_summary_on_profiles();
