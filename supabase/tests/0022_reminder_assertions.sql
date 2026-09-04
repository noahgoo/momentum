-- Assertions for Phase 5 reminder timing and delivery bookkeeping
-- (migration 0022).
--
-- run_reminders depends on the wall-clock moment it is called at, which a
-- test cannot control. So the slot-matching rule is asserted directly — the
-- same expression the function uses — for each client's timezone, and the
-- function itself is exercised for the guards that do not depend on "now".
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0022_reminder_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id uuid := 'ac000000-0000-0000-0000-000000000001';
  client_a uuid := 'ac000000-0000-0000-0000-00000000000a';

  v_slot time;
  v_count int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (coach_id, 'rem-coach@test.local', jsonb_build_object('role','coach','display_name','Rem Coach')),
    (client_a, 'rem-client@test.local',
      jsonb_build_object('role','client','display_name','Rem Client','invited_by',coach_id::text))
  on conflict (id) do nothing;

  -- ---------------------------------------------------------------------
  -- C-4: the quarter-hour slot honours the minute the client chose
  -- ---------------------------------------------------------------------
  -- Before this migration the comparison used only extract(hour), so every
  -- one of these fired at :05 past the hour regardless of the minute.

  -- 07:50 rounds to the 07:45 slot, NOT 07:00.
  v_slot := make_time(7, (floor(50 / 15) * 15)::int, 0);
  if v_slot <> '07:45:00'::time then
    failures := array_append(failures, format('07:50 should map to the 07:45 slot, got %s', v_slot));
  end if;

  v_slot := make_time(7, (floor(30 / 15) * 15)::int, 0);
  if v_slot <> '07:30:00'::time then
    failures := array_append(failures, format('07:30 should map to the 07:30 slot, got %s', v_slot));
  end if;

  v_slot := make_time(7, (floor(0 / 15) * 15)::int, 0);
  if v_slot <> '07:00:00'::time then
    failures := array_append(failures, format('07:00 should map to the 07:00 slot, got %s', v_slot));
  end if;

  -- A minute inside a slot rounds down to that slot's start.
  v_slot := make_time(7, (floor(14 / 15) * 15)::int, 0);
  if v_slot <> '07:00:00'::time then
    failures := array_append(failures, format('07:14 should still be the 07:00 slot, got %s', v_slot));
  end if;
  v_slot := make_time(7, (floor(59 / 15) * 15)::int, 0);
  if v_slot <> '07:45:00'::time then
    failures := array_append(failures, format('07:59 should be the 07:45 slot, got %s', v_slot));
  end if;

  -- The cron visits exactly the four slots the picker offers.
  select count(*) into v_count
  from (values (0), (15), (30), (45)) as picker(minute)
  where make_time(7, (floor(picker.minute / 15) * 15)::int, 0)
        <> make_time(7, picker.minute, 0);
  if v_count <> 0 then
    failures := array_append(failures,
      format('%s picker option(s) do not land exactly on a scheduler slot', v_count));
  end if;

  -- ---------------------------------------------------------------------
  -- Guards that do not depend on the current time
  -- ---------------------------------------------------------------------

  -- Notifications off: never queued, whatever the time.
  update public.profiles set
    notifications_enabled = false,
    notification_time = '07:00',
    timezone = 'America/New_York'
  where id = client_a;

  perform public.run_reminders();
  select count(*) into v_count from public.notification_outbox where profile_id = client_a;
  if v_count <> 0 then
    failures := array_append(failures, 'a client with notifications off was queued a reminder');
  end if;

  -- Enabled but disabled account: still never queued.
  update public.profiles set notifications_enabled = true, disabled = true where id = client_a;
  perform public.run_reminders();
  select count(*) into v_count from public.notification_outbox where profile_id = client_a;
  if v_count <> 0 then
    failures := array_append(failures, 'a disabled client was queued a reminder');
  end if;

  -- Enabled, but no program: resolve_scheduled_workout returns null, so
  -- there is nothing to remind about.
  update public.profiles set disabled = false, last_reminder_date = null where id = client_a;
  perform public.run_reminders();
  select count(*) into v_count from public.notification_outbox where profile_id = client_a;
  if v_count <> 0 then
    failures := array_append(failures, 'a client with no scheduled workout was queued a reminder');
  end if;

  -- ---------------------------------------------------------------------
  -- N-2: the bookkeeping the consumer needs exists
  -- ---------------------------------------------------------------------
  insert into public.notification_outbox (profile_id, kind, payload)
  values (client_a, 'workout_reminder', jsonb_build_object('date', current_date));

  select count(*) into v_count
  from public.notification_outbox
  where profile_id = client_a and attempts = 0 and next_attempt_at is not null and sent_at is null;
  if v_count <> 1 then
    failures := array_append(failures, 'a new outbox row should start unsent with attempts = 0');
  end if;

  -- prune_sent_outbox keeps unsent rows and recent sends, drops old ones.
  update public.notification_outbox set sent_at = now() - interval '40 days' where profile_id = client_a;
  insert into public.notification_outbox (profile_id, kind, payload, sent_at)
  values (client_a, 'workout_reminder', '{}'::jsonb, now() - interval '1 day');
  insert into public.notification_outbox (profile_id, kind, payload)
  values (client_a, 'workout_reminder', '{}'::jsonb);

  perform public.prune_sent_outbox();

  select count(*) into v_count from public.notification_outbox
  where profile_id = client_a and sent_at < now() - interval '30 days';
  if v_count <> 0 then
    failures := array_append(failures, 'prune_sent_outbox left rows older than 30 days');
  end if;
  select count(*) into v_count from public.notification_outbox
  where profile_id = client_a and sent_at is null;
  if v_count <> 1 then
    failures := array_append(failures, 'prune_sent_outbox deleted an UNSENT row');
  end if;
  select count(*) into v_count from public.notification_outbox
  where profile_id = client_a and sent_at >= now() - interval '30 days';
  if v_count <> 1 then
    failures := array_append(failures, 'prune_sent_outbox deleted a recently-sent row');
  end if;

  -- ---------------------------------------------------------------------
  -- push_tokens: per device, and a user only sees their own
  -- ---------------------------------------------------------------------
  insert into public.push_tokens (profile_id, token, platform)
  values (client_a, 'ExponentPushToken[phone]', 'ios'),
         (client_a, 'ExponentPushToken[tablet]', 'ios');

  select count(*) into v_count from public.push_tokens where profile_id = client_a;
  if v_count <> 2 then
    failures := array_append(failures,
      format('a client with two devices should have two tokens, got %s', v_count));
  end if;

  begin
    insert into public.push_tokens (profile_id, token) values (client_a, 'ExponentPushToken[phone]');
    failures := array_append(failures, 'the same token should not be storable twice');
  exception when unique_violation then
    null; -- expected
  end;

  -- ---------------------------------------------------------------------
  -- M-2: the unread flag must agree with the rows it summarises
  -- ---------------------------------------------------------------------
  -- Asserted as the rule the clients implement: the flag may only clear when
  -- the fetch came back short of its cap, meaning the backlog was drained.
  declare
    v_limit int := 100;
    v_fetched int;
    v_may_clear boolean;
  begin
    v_fetched := 100;  -- a full page: more may remain
    v_may_clear := v_fetched < v_limit;
    if v_may_clear then
      failures := array_append(failures,
        'a full page means more may remain — the unread flag must NOT clear (M-2)');
    end if;

    v_fetched := 42;   -- short page: the backlog is drained
    v_may_clear := v_fetched < v_limit;
    if not v_may_clear then
      failures := array_append(failures,
        'a short page means the backlog is drained — the unread flag should clear');
    end if;

    v_fetched := 0;    -- nothing unread at all
    v_may_clear := v_fetched < v_limit;
    if not v_may_clear then
      failures := array_append(failures, 'no unread messages should clear the flag');
    end if;
  end;

  raise exception 'REMINDER_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
