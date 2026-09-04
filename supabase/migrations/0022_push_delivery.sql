-- Phase 5 of the ruleset remediation (docs/rules/violations.md N-1, N-2,
-- C-2, C-4, C-5).
--
-- run_hourly_reminders has been writing rows into notification_outbox that
-- NOTHING ever reads: sent_at was never stamped, no push was ever sent, and
-- there was no push-token column anywhere to send to. Meanwhile the settings
-- screen let clients enable reminders and pick a time, promising something
-- the system could not deliver (N-1).
--
-- This migration is the database half — tokens, retry bookkeeping, and the
-- timing fixes. The consumer is supabase/functions/send-notifications.
--
-- Timing bugs fixed here:
--   C-4 reminders compared only the HOUR while the picker offers quarter
--       hours, so a client who set 7:50 was reminded at 7:05 — 45 minutes
--       early, with the stored minute silently discarded.
--   C-2 run_daily_maintenance ran at '0 9 * * *' — 9am UTC, one instant for
--       everyone — so streaks and "today's workout" rolled over at the wrong
--       moment for every client outside that offset.
--   C-5 last_reminder_date was stamped with the client's local date, so
--       travelling west past the notification hour could produce a second
--       reminder on the same local date.

-- ---------------------------------------------------------------------------
-- push_tokens
-- ---------------------------------------------------------------------------
-- A table, not a profiles column: a client with a phone and a tablet has two
-- tokens and both should ring (docs/rules/notifications.md N2).

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  platform text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.push_tokens is
  'Expo push tokens, one row per device. Deleted on sign-out and on a permanent send failure (an uninstalled app), so a dead token is not retried forever.';

create index push_tokens_profile_id_idx on public.push_tokens (profile_id);

alter table public.push_tokens enable row level security;

create policy push_tokens_own_all
  on public.push_tokens for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

comment on policy push_tokens_own_all on public.push_tokens is
  'A user manages only their own device tokens. The consumer reads them as the service role, which bypasses RLS.';

-- ---------------------------------------------------------------------------
-- Outbox retry bookkeeping (N-2)
-- ---------------------------------------------------------------------------

alter table public.notification_outbox
  add column attempts int not null default 0,
  add column last_error text,
  add column next_attempt_at timestamptz not null default now();

comment on column public.notification_outbox.attempts is
  'Send attempts so far. The consumer stops retrying past a cap so a permanently failing row cannot spin forever.';
comment on column public.notification_outbox.next_attempt_at is
  'Earliest time to try again — exponential backoff after a transient failure.';

create index notification_outbox_due_idx
  on public.notification_outbox (next_attempt_at)
  where sent_at is null;

-- ---------------------------------------------------------------------------
-- run_reminders: quarter-hour matching (C-4, C-5)
-- ---------------------------------------------------------------------------

create function public.run_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client record;
  v_tz text;
  v_local_now timestamp;
  v_local_today date;
  v_slot time;
begin
  for v_client in
    select id, timezone, notification_time, last_reminder_date
    from public.profiles
    where role = 'client'
      and not disabled
      and notifications_enabled
      and notification_time is not null
  loop
    v_tz := coalesce(v_client.timezone, 'America/New_York');
    v_local_now := now() at time zone v_tz;
    v_local_today := v_local_now::date;

    -- Round the client's local time DOWN to a quarter hour and compare with
    -- their chosen time rounded the same way. The picker only offers
    -- :00/:15/:30/:45, so this honours the minute they actually set instead
    -- of firing everyone at the top of the hour.
    v_slot := make_time(
      extract(hour from v_local_now)::int,
      (floor(extract(minute from v_local_now) / 15) * 15)::int,
      0
    );

    -- The client's chosen time, rounded the same way, so a value that
    -- predates the quarter-hour picker still lands on a slot the scheduler
    -- actually visits rather than never firing at all.
    if v_slot is distinct from make_time(
         extract(hour from v_client.notification_time)::int,
         (floor(extract(minute from v_client.notification_time) / 15) * 15)::int,
         0
       ) then
      continue;
    end if;

    -- At most once per client per local day. Comparing against the client's
    -- own local date (not the server's) is what makes travelling east or west
    -- unable to produce a second reminder for the same day (C-5).
    if v_client.last_reminder_date is not distinct from v_local_today then
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
    values (
      v_client.id,
      'workout_reminder',
      -- Ids and a date, never rendered text: the workout can change between
      -- queueing and delivery (N3).
      jsonb_build_object('date', v_local_today)
    );

    update public.profiles set last_reminder_date = v_local_today where id = v_client.id;
  end loop;
end;
$$;

comment on function public.run_reminders() is
  'Cron entry point, every 15 minutes: queues a workout_reminder for each enabled client whose local quarter-hour slot matches their notification_time, who has not been reminded on their own local date, and who has a scheduled and still-incomplete workout. Replaces run_hourly_reminders, which compared only the hour and so fired a 7:50 reminder at 7:05.';

revoke execute on function public.run_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- run_daily_maintenance -> per-client local midnight (C-2)
-- ---------------------------------------------------------------------------

create or replace function public.run_daily_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client record;
  v_pair_id text;
begin
  -- Runs hourly and refreshes only the clients whose LOCAL day just rolled
  -- over. A single UTC time was one instant for everyone, so a coach's
  -- dashboard showed yesterday's streak for part of every day.
  for v_client in
    select id, timezone from public.profiles where role = 'client'
  loop
    if extract(hour from (now() at time zone coalesce(v_client.timezone, 'America/New_York')))::int = 0 then
      perform public.refresh_client_summary(v_client.id);
    end if;
  end loop;

  for v_pair_id in select f.pair_id from public.friendships f where f.status = 'accepted' loop
    perform public.recompute_friendship_stats(v_pair_id);
  end loop;
end;
$$;

comment on function public.run_daily_maintenance() is
  'Hourly cron entry point: refreshes client_summaries for the clients whose LOCAL date just rolled over (midnight in their own timezone), and recomputes friendship stats. Was scheduled once daily at 9am UTC, which is the wrong moment for every client outside that offset (C-2).';

-- ---------------------------------------------------------------------------
-- prune_sent_outbox: an outbox that only grows is a slow outage (N-2)
-- ---------------------------------------------------------------------------

create function public.prune_sent_outbox()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notification_outbox
  where sent_at is not null and sent_at < now() - interval '30 days';
$$;

comment on function public.prune_sent_outbox() is
  'Deletes outbox rows sent more than 30 days ago.';

revoke execute on function public.prune_sent_outbox() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reschedule cron
-- ---------------------------------------------------------------------------

do $$
begin
  perform cron.unschedule('momentum_hourly_reminders');
exception when others then
  null; -- not scheduled in this environment
end;
$$;

do $$
begin
  perform cron.unschedule('momentum_daily_maintenance');
exception when others then
  null;
end;
$$;

do $$
begin
  -- Every quarter hour, matching the picker's granularity (C-4).
  perform cron.schedule(
    'momentum_reminders',
    '0,15,30,45 * * * *',
    $cron$select public.run_reminders();$cron$
  );
  -- Hourly, so each timezone's local midnight is caught (C-2).
  perform cron.schedule(
    'momentum_daily_maintenance',
    '0 * * * *',
    $cron$select public.run_daily_maintenance();$cron$
  );
  perform cron.schedule(
    'momentum_prune_outbox',
    '30 4 * * *',
    $cron$select public.prune_sent_outbox();$cron$
  );
exception
  when undefined_table or undefined_function or invalid_schema_name then
    raise notice 'pg_cron not available — schedule run_reminders (every 15 min), run_daily_maintenance (hourly) and prune_sent_outbox (daily) from an external scheduler instead.';
end;
$$;
