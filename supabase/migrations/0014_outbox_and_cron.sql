-- Wave 3.5: notification outbox table + daily/hourly maintenance functions +
-- pg_cron schedules. Phase 1: outbox rows only, no push sending.

-- ---------------------------------------------------------------------------
-- notification_outbox
-- ---------------------------------------------------------------------------

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

comment on table public.notification_outbox is
  'Queued notifications for an out-of-band sender (Edge Function / external worker) to consume and mark sent. RLS enabled with no policies — service-role only.';

alter table public.notification_outbox enable row level security;
-- Intentionally no policies: only the service role (which bypasses RLS) or a
-- SECURITY DEFINER function may read/write this table.

create index notification_outbox_profile_id_idx on public.notification_outbox (profile_id);
create index notification_outbox_unsent_idx on public.notification_outbox (sent_at) where sent_at is null;

-- ---------------------------------------------------------------------------
-- run_daily_maintenance: full summary rebuild + friendship stats refresh
-- ---------------------------------------------------------------------------

create function public.run_daily_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pair_id text;
begin
  perform public.refresh_all_client_summaries();

  for v_pair_id in select f.pair_id from public.friendships f where f.status = 'accepted' loop
    perform public.recompute_friendship_stats(v_pair_id);
  end loop;
end;
$$;

comment on function public.run_daily_maintenance() is
  'Daily cron entry point: rebuilds every client_summaries row and recomputes stats for every accepted friendship, so streaks/today-flags roll over even without a write triggering it.';

revoke execute on function public.run_daily_maintenance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- run_hourly_reminders: queue a workout_reminder outbox row for each client
-- whose local hour matches their preferred notification_time, once per day.
-- ---------------------------------------------------------------------------

create function public.run_hourly_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client record;
  v_local_today date;
  v_local_hour int;
begin
  for v_client in
    select id, timezone, notification_time
    from public.profiles
    where role = 'client'
      and not disabled
      and notifications_enabled
      and notification_time is not null
  loop
    v_local_today := (now() at time zone coalesce(v_client.timezone, 'America/New_York'))::date;
    v_local_hour := extract(hour from (now() at time zone coalesce(v_client.timezone, 'America/New_York')))::int;

    if v_local_hour <> extract(hour from v_client.notification_time)::int then
      continue;
    end if;

    if exists (
      select 1 from public.profiles p
      where p.id = v_client.id and p.last_reminder_date = v_local_today
    ) then
      continue;
    end if;

    if public.resolve_scheduled_workout(v_client.id, v_local_today) is null then
      continue;
    end if;

    if exists (
      select 1 from public.workout_logs wl
      where wl.client_id = v_client.id and wl.date = v_local_today and wl.completed
    ) then
      continue;
    end if;

    insert into public.notification_outbox (profile_id, kind, payload)
    values (v_client.id, 'workout_reminder', jsonb_build_object('date', v_local_today));

    update public.profiles set last_reminder_date = v_local_today where id = v_client.id;
  end loop;
end;
$$;

comment on function public.run_hourly_reminders() is
  'Hourly cron entry point (finding #9): for each enabled, non-disabled client with notification_time set whose local hour matches and who hasn''t been reminded today, with a scheduled-and-incomplete workout today, inserts a workout_reminder outbox row and stamps last_reminder_date. Push-token/dead-token handling is the outbox consumer''s concern, not this function''s.';

revoke execute on function public.run_hourly_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- pg_cron schedules
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
exception
  when undefined_file or feature_not_supported or insufficient_privilege then
    raise notice 'pg_cron extension unavailable in this environment (%). Fallback: trigger run_daily_maintenance() and run_hourly_reminders() from an external scheduler (e.g. a Supabase Edge Function on a cron trigger, or GitHub Actions hitting an RPC endpoint) instead.', sqlerrm;
end;
$$;

do $$
begin
  perform cron.schedule(
    'momentum_daily_maintenance',
    '0 9 * * *',
    $cron$select public.run_daily_maintenance();$cron$
  );
  perform cron.schedule(
    'momentum_hourly_reminders',
    '5 * * * *',
    $cron$select public.run_hourly_reminders();$cron$
  );
exception
  when undefined_table or undefined_function or invalid_schema_name then
    raise notice 'pg_cron not available — could not schedule momentum_daily_maintenance / momentum_hourly_reminders. Fallback: trigger run_daily_maintenance() and run_hourly_reminders() from an external scheduler instead.';
end;
$$;
