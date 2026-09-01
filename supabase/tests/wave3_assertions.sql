-- Wave 3 SQL assertion suite.
--
-- Single script, rollback-safe: everything happens inside one outer
-- transaction (BEGIN/ROLLBACK at the bottom) so it never leaves fixture data
-- behind, and inside that, one DO $$ block that (a) inserts fixtures with
-- fixed UUIDs, (b) runs assertions collecting failures into a text[], and
-- (c) always raises an exception at the end reporting PASSED/FAILED plus the
-- failure list — so the result is readable directly from the error message
-- and the whole thing rolls back regardless of outcome.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/wave3_assertions.sql
-- (or via the Supabase CLI / MCP execute_sql against a branch/local db).

begin;

do $$
declare
  failures text[] := '{}';

  -- Fixture identities
  coach_id uuid := 'a0000000-0000-0000-0000-000000000001';
  client_a uuid := 'a0000000-0000-0000-0000-00000000000a';
  client_b uuid := 'a0000000-0000-0000-0000-00000000000b';
  client_c uuid := 'a0000000-0000-0000-0000-00000000000c'; -- no active assignment (fallback streak)

  -- Workouts
  w1 uuid := 'b0000000-0000-0000-0000-000000000001';
  w2 uuid := 'b0000000-0000-0000-0000-000000000002';
  w3 uuid := 'b0000000-0000-0000-0000-000000000003';
  w4 uuid := 'b0000000-0000-0000-0000-000000000004';
  wb1 uuid := 'b0000000-0000-0000-0000-000000000005';
  w9 uuid := 'b0000000-0000-0000-0000-000000000009';
  wbonus uuid := 'b0000000-0000-0000-0000-00000000000b';

  -- Programs / phases / assignments
  program_p1 uuid := 'c0000000-0000-0000-0000-000000000001';
  program_p2 uuid := 'c0000000-0000-0000-0000-000000000002';
  phase_a uuid := 'd0000000-0000-0000-0000-000000000001';
  phase_b uuid := 'd0000000-0000-0000-0000-000000000002';
  assignment_a uuid := 'e0000000-0000-0000-0000-000000000001';
  assignment_b uuid := 'e0000000-0000-0000-0000-000000000002';

  start_date date := '2026-06-29'; -- Monday

  -- Change requests
  cr_pending uuid := 'f0000000-0000-0000-0000-000000000001';

  -- Friendships
  pair_ab text;

  -- scratch
  v_result uuid;
  v_int_result int;
  v_caught boolean;
  v_stats jsonb;
  v_shared_streak int;
  v_today date;
  v_yesterday date;
begin
  -------------------------------------------------------------------------
  -- Fixtures
  -------------------------------------------------------------------------

  -- auth.users rows (minimal) — also exercises the 0010 signup trigger:
  -- inserting here should auto-create the matching public.profiles row via
  -- handle_new_user(), which we then UPDATE in place to set full fixture
  -- data (role/timezone/etc. can't all be pushed through raw_user_meta_data
  -- cleanly for a coach, so we set it directly afterward).
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'coach@example.test', jsonb_build_object('role', 'coach', 'display_name', 'Coach C')),
    (client_a, 'client-a@example.test', jsonb_build_object('role', 'client', 'display_name', 'Client A', 'invited_by', coach_id::text)),
    (client_b, 'client-b@example.test', jsonb_build_object('role', 'client', 'display_name', 'Client B', 'invited_by', coach_id::text)),
    (client_c, 'client-c@example.test', jsonb_build_object('role', 'client', 'display_name', 'Client C', 'invited_by', coach_id::text))
  on conflict (id) do nothing;

  -- Assertion: 0010 signup trigger populated profiles automatically.
  if not exists (select 1 from public.profiles where id = coach_id and role = 'coach') then
    failures := failures || 'handle_new_user did not create coach profile row';
  end if;
  if not exists (select 1 from public.profiles where id = client_a and role = 'client' and invited_by = coach_id) then
    failures := failures || 'handle_new_user did not create client_a profile row with invited_by';
  end if;

  -- Pin timezone explicitly (UTC) so client_today()/compute_streak() are
  -- deterministic regardless of session tz. All "today" fixtures below are
  -- framed as if run "as of" 2026-07-10 by passing explicit as_of dates to
  -- compute_streak/resolve_scheduled_workout rather than relying on now().
  update public.profiles set timezone = 'UTC' where id in (client_a, client_b, client_c);

  -- Program p1: 2 weeks, program-level week_schedules. Monday=w1/w3,
  -- Wednesday=w2/w4 (mirrors packages/shared/test-fixtures/schedule-cases.json).
  insert into public.programs (id, name, weeks, created_by)
  values (program_p1, 'Fixture Program 1', 2, coach_id);

  insert into public.workouts (id, name, created_by) values
    (w1, 'Workout 1', coach_id),
    (w2, 'Workout 2', coach_id),
    (w3, 'Workout 3', coach_id),
    (w4, 'Workout 4', coach_id),
    (wb1, 'Phase B Workout 1', coach_id),
    (w9, 'Override Workout', coach_id),
    (wbonus, 'Bonus Workout', coach_id);

  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id) values
    (program_p1, 1, 'monday', w1),
    (program_p1, 1, 'wednesday', w2),
    (program_p1, 2, 'monday', w3),
    (program_p1, 2, 'wednesday', w4);

  insert into public.assignments (id, client_id, program_id, start_date, active)
  values (assignment_a, client_a, program_p1, start_date, true);

  -- Program p2: 2 phases (phase A = 2 weeks, phase B = 1 week), phase-level
  -- week_schedules. Global week 3 (phase B week 1) Monday = wb1.
  insert into public.programs (id, name, weeks, created_by)
  values (program_p2, 'Fixture Program 2 (phased)', 3, coach_id);

  insert into public.program_phases (id, program_id, name, sort_order, weeks) values
    (phase_a, program_p2, 'Phase A', 1, 2),
    (phase_b, program_p2, 'Phase B', 2, 1);

  insert into public.week_schedules (phase_id, week_number, day_of_week, workout_id) values
    (phase_a, 1, 'monday', w1),
    (phase_a, 2, 'monday', w3),
    (phase_b, 1, 'monday', wb1);

  insert into public.assignments (id, client_id, program_id, start_date, active)
  values (assignment_b, client_b, program_p2, start_date, true);

  -------------------------------------------------------------------------
  -- resolve_scheduled_workout: fixture-derived cases (schedule-cases.json)
  -------------------------------------------------------------------------

  -- 1. Week 1 Monday resolves scheduled workout.
  v_result := public.resolve_scheduled_workout(client_a, '2026-06-29');
  if v_result is distinct from w1 then
    failures := failures || format('resolve_scheduled_workout week1 monday: expected %s got %s', w1, v_result);
  end if;

  -- 2. Week 1 Wednesday resolves scheduled workout.
  v_result := public.resolve_scheduled_workout(client_a, '2026-07-01');
  if v_result is distinct from w2 then
    failures := failures || format('resolve_scheduled_workout week1 wednesday: expected %s got %s', w2, v_result);
  end if;

  -- 3. Rest day (unscheduled day of week) resolves to null.
  v_result := public.resolve_scheduled_workout(client_a, '2026-06-30');
  if v_result is not null then
    failures := failures || format('resolve_scheduled_workout rest day: expected null got %s', v_result);
  end if;

  -- 4. Before program start resolves to null.
  v_result := public.resolve_scheduled_workout(client_a, '2026-06-28');
  if v_result is not null then
    failures := failures || format('resolve_scheduled_workout before start: expected null got %s', v_result);
  end if;

  -- 5. Week rollover: day 8 after start is week 2 (2026-07-06 = Monday).
  v_result := public.resolve_scheduled_workout(client_a, '2026-07-06');
  if v_result is distinct from w3 then
    failures := failures || format('resolve_scheduled_workout week rollover: expected %s got %s', w3, v_result);
  end if;

  -- 6. Past program end resolves to null.
  v_result := public.resolve_scheduled_workout(client_a, '2026-07-20');
  if v_result is not null then
    failures := failures || format('resolve_scheduled_workout past program end: expected null got %s', v_result);
  end if;

  -- 7. Phase flattening: phase A 2 weeks, phase B week 1 = global week 3.
  v_result := public.resolve_scheduled_workout(client_b, '2026-07-13'); -- Monday, global week 3
  if v_result is distinct from wb1 then
    failures := failures || format('resolve_scheduled_workout phase flattening: expected %s got %s', wb1, v_result);
  end if;

  -- 8. Override wins outright over computed schedule.
  insert into public.assignment_date_overrides (assignment_id, date, workout_id)
  values (assignment_a, '2026-06-29', w9);
  v_result := public.resolve_scheduled_workout(client_a, '2026-06-29');
  if v_result is distinct from w9 then
    failures := failures || format('resolve_scheduled_workout override wins: expected %s got %s', w9, v_result);
  end if;

  -- 9. Explicit-rest override (NULL) beats a normally-scheduled workout.
  delete from public.assignment_date_overrides where assignment_id = assignment_a and date = '2026-06-29';
  insert into public.assignment_date_overrides (assignment_id, date, workout_id)
  values (assignment_a, '2026-06-29', null);
  v_result := public.resolve_scheduled_workout(client_a, '2026-06-29');
  if v_result is not null then
    failures := failures || format('resolve_scheduled_workout explicit rest override: expected null got %s', v_result);
  end if;

  -- 10. Override can add a workout on an otherwise-rest day.
  insert into public.assignment_date_overrides (assignment_id, date, workout_id)
  values (assignment_a, '2026-06-30', wbonus);
  v_result := public.resolve_scheduled_workout(client_a, '2026-06-30');
  if v_result is distinct from wbonus then
    failures := failures || format('resolve_scheduled_workout override adds workout: expected %s got %s', wbonus, v_result);
  end if;

  -- Clean up overrides before the streak vectors below (which assume the
  -- unmodified w1/w2/w3/w4 Mon/Wed schedule for client_a).
  delete from public.assignment_date_overrides where assignment_id = assignment_a;

  -------------------------------------------------------------------------
  -- compute_streak: vectors ported from old streak.test.ts
  -- Program: client_a, start 2026-06-29 (Mon), Mon/Wed scheduled (weeks 1-2
  -- only — 2026-07-01 is the last Wed in range for our vectors' purposes).
  -- To exercise Mon/Wed/Fri-style vectors independent of program length, we
  -- widen client_a's program to 6 weeks for the streak section only, adding
  -- a Friday slot, matching old-app test fixture semantics (Mon/Wed/Fri).
  -------------------------------------------------------------------------

  update public.programs set weeks = 6 where id = program_p1;
  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id) values
    (program_p1, 1, 'friday', w1),
    (program_p1, 2, 'friday', w3);
  -- (week 1: mon/wed/fri = 06-29, 07-01, 07-03; week 2: mon/wed/fri = 07-06, 07-08, 07-10)

  -- Vector: keeps counting through rest days without breaking the streak.
  -- All workout days 06-29..07-08 completed; as_of = Thu 07-09 (rest day).
  -- Expected streak = 11 (every day 06-29 through 07-09 inclusive).
  delete from public.workout_logs where client_id = client_a;
  insert into public.workout_logs (client_id, workout_id, date, completed) values
    (client_a, w1, '2026-06-29', true),
    (client_a, w2, '2026-07-01', true),
    (client_a, w1, '2026-07-03', true),
    (client_a, w3, '2026-07-06', true),
    (client_a, w4, '2026-07-08', true);
  v_int_result := public.compute_streak(client_a, '2026-07-09');
  if v_int_result is distinct from 11 then
    failures := failures || format('compute_streak rest-day continue: expected 11 got %s', v_int_result);
  end if;

  -- Vector: breaks the streak on a missed workout day. Only 06-29
  -- completed; Wed 07-01 (scheduled) missed. as_of = 07-02 (rest, Thursday).
  -- Expected streak = 1 (07-02 rest day counts; walk stops at the 07-01 miss).
  delete from public.workout_logs where client_id = client_a;
  insert into public.workout_logs (client_id, workout_id, date, completed) values
    (client_a, w1, '2026-06-29', true);
  v_int_result := public.compute_streak(client_a, '2026-07-02');
  if v_int_result is distinct from 1 then
    failures := failures || format('compute_streak missed-day break: expected 1 got %s', v_int_result);
  end if;

  -- Vector: does not penalize today's pending workout (grace day). as_of =
  -- 07-10 (Fri, scheduled, not completed) -> grace steps back to 07-09.
  -- Completed 06-29,07-01,07-03,07-06,07-08. Expected streak = 11 (06-29..07-09).
  delete from public.workout_logs where client_id = client_a;
  insert into public.workout_logs (client_id, workout_id, date, completed) values
    (client_a, w1, '2026-06-29', true),
    (client_a, w2, '2026-07-01', true),
    (client_a, w1, '2026-07-03', true),
    (client_a, w3, '2026-07-06', true),
    (client_a, w4, '2026-07-08', true);
  v_int_result := public.compute_streak(client_a, '2026-07-10');
  if v_int_result is distinct from 11 then
    failures := failures || format('compute_streak grace day: expected 11 got %s', v_int_result);
  end if;

  -- Vector: stops counting once before program start. Only 06-29 completed.
  -- as_of = 06-30 (Tue, rest day). Expected streak = 2 (06-29 completed
  -- workout + 06-30 rest); walk then hits 06-28 < start_date and stops.
  delete from public.workout_logs where client_id = client_a;
  insert into public.workout_logs (client_id, workout_id, date, completed) values
    (client_a, w1, '2026-06-29', true);
  v_int_result := public.compute_streak(client_a, '2026-06-30');
  if v_int_result is distinct from 2 then
    failures := failures || format('compute_streak program-start bound: expected 2 got %s', v_int_result);
  end if;

  -- Reset client_a's program back to 2 weeks / no Friday slot and clear logs
  -- so later sections aren't affected by this section's fixtures.
  delete from public.week_schedules where program_id = program_p1 and day_of_week = 'friday';
  update public.programs set weeks = 2 where id = program_p1;
  delete from public.workout_logs where client_id = client_a;

  -- Fallback vector: client_c has no active assignment -> plain consecutive-
  -- completed-dates walk. Parity with old computeStreak(dates, today).
  insert into public.workout_logs (client_id, workout_id, date, completed) values
    (client_c, null, '2026-07-07', true),
    (client_c, null, '2026-07-06', true),
    (client_c, null, '2026-07-05', true);
  v_int_result := public.compute_streak(client_c, '2026-07-07');
  if v_int_result is distinct from 3 then
    failures := failures || format('compute_streak fallback (no assignment): expected 3 got %s', v_int_result);
  end if;

  -- Fallback grace: today not logged yet -> streak still counts through
  -- yesterday.
  delete from public.workout_logs where client_id = client_c;
  insert into public.workout_logs (client_id, workout_id, date, completed) values
    (client_c, null, '2026-07-06', true),
    (client_c, null, '2026-07-05', true),
    (client_c, null, '2026-07-04', true);
  v_int_result := public.compute_streak(client_c, '2026-07-07');
  if v_int_result is distinct from 3 then
    failures := failures || format('compute_streak fallback grace: expected 3 got %s', v_int_result);
  end if;
  delete from public.workout_logs where client_id = client_c;

  -------------------------------------------------------------------------
  -- accept_change_request: swap correctness + double-accept failure, via
  -- apply_change_request_swap directly (called as postgres — the auth check
  -- inside accept_change_request itself is asserted separately below).
  -------------------------------------------------------------------------

  -- client_a: 2026-06-29 (Mon) = w1 scheduled, 2026-06-30 (Tue) = rest.
  insert into public.change_requests (id, client_id, coach_id, from_date, to_date, status)
  values (cr_pending, client_a, coach_id, '2026-06-29', '2026-06-30', 'pending');

  perform public.apply_change_request_swap(cr_pending);

  -- After swap: to_date (06-30) should now resolve to w1 (what was on
  -- from_date); from_date (06-29) should resolve to null (what was on
  -- to_date, i.e. rest).
  v_result := public.resolve_scheduled_workout(client_a, '2026-06-30');
  if v_result is distinct from w1 then
    failures := failures || format('apply_change_request_swap to_date: expected %s got %s', w1, v_result);
  end if;
  v_result := public.resolve_scheduled_workout(client_a, '2026-06-29');
  if v_result is not null then
    failures := failures || format('apply_change_request_swap from_date: expected null got %s', v_result);
  end if;

  if not exists (select 1 from public.change_requests where id = cr_pending and status = 'accepted' and responded_at is not null) then
    failures := failures || 'apply_change_request_swap did not flip status to accepted';
  end if;

  -- Double-accept: calling again on an already-accepted request should
  -- raise nothing_to_move (from_date is now a rest day, so from_workout is
  -- null) — apply_change_request_swap has no status guard itself (that's
  -- accept_change_request's job), but re-resolving live means the second
  -- call fails naturally once the schedule no longer has anything on
  -- from_date. We assert it raises.
  v_caught := false;
  begin
    perform public.apply_change_request_swap(cr_pending);
  exception
    when others then
      v_caught := true;
  end;
  if not v_caught then
    failures := failures || 'apply_change_request_swap on an already-swapped request should raise (nothing_to_move) but did not';
  end if;

  -- Auth check: accept_change_request itself must raise when the request
  -- doesn't belong to the calling coach. In this test context auth.uid() is
  -- null (no JWT), so coach_id (a real uuid) is always <> auth.uid() —
  -- exercising the not_found_or_forbidden path.
  insert into public.change_requests (client_id, coach_id, from_date, to_date, status)
  values (client_a, coach_id, '2026-07-01', '2026-07-02', 'pending')
  returning id into v_result;

  v_caught := false;
  begin
    perform public.accept_change_request(v_result);
  exception
    when others then
      v_caught := true;
  end;
  if not v_caught then
    failures := failures || 'accept_change_request should raise not_found_or_forbidden when auth.uid() does not match coach_id';
  end if;

  -------------------------------------------------------------------------
  -- friendships: pair_id sort invariant, duplicate insert conflict,
  -- shared-streak one-member-completes case.
  -------------------------------------------------------------------------

  -- pair_id must sort consistently regardless of which uuid is client_id vs
  -- friend_id.
  insert into public.friendships (client_id, friend_id, requested_by, status)
  values (client_b, client_a, client_b, 'pending')
  returning pair_id into pair_ab;

  if pair_ab <> (least(client_a::text, client_b::text) || '_' || greatest(client_a::text, client_b::text)) then
    failures := failures || format('friendships pair_id sort invariant: got %s', pair_ab);
  end if;

  -- Duplicate insert (same pair, either order) must conflict on the pair_id PK.
  v_caught := false;
  begin
    insert into public.friendships (client_id, friend_id, requested_by, status)
    values (client_a, client_b, client_a, 'pending');
  exception
    when unique_violation then
      v_caught := true;
  end;
  if not v_caught then
    failures := failures || 'friendships duplicate insert (reversed member order) should conflict on pair_id but did not';
  end if;

  -- Accept the friendship (bypassing RLS client policies since we're
  -- postgres here) and let the accept trigger seed stats.
  update public.friendships set status = 'accepted', accepted_at = now() where pair_id = pair_ab;

  if not exists (select 1 from public.friendships where pair_id = pair_ab and stats is not null) then
    failures := failures || 'recompute_friendship_stats did not seed stats on accept';
  end if;

  -- Shared-streak one-member-completes case. recompute_friendship_stats
  -- anchors its walk on the real client_today() (both members pinned to
  -- UTC), so this fixture uses dates relative to the real current_date
  -- rather than the fixed 2026-06 dates used above, to get a deterministic
  -- result regardless of when this script is run. Neither client_a nor
  -- client_b has any active-assignment schedule covering "yesterday" here
  -- (their assignments start 2026-06-29, long past for any real run date;
  -- if run before 2026-06-29 this section is skipped defensively below), so
  -- yesterday is unscheduled (rest) for both — only a completed log makes
  -- a day count, per finding #4.
  v_today := current_date;
  v_yesterday := current_date - 1;

  if v_yesterday >= start_date then
    delete from public.workout_logs where client_id in (client_a, client_b);
    -- Only client_a completes a workout yesterday; client_b does nothing.
    -- Per finding #4, one member completing suffices to count the day.
    insert into public.workout_logs (client_id, workout_id, date, completed)
    values (client_a, w1, v_yesterday, true);

    perform public.recompute_friendship_stats(pair_ab);
    select stats, shared_streak into v_stats, v_shared_streak
    from public.friendships where pair_id = pair_ab;

    if v_stats is null then
      failures := failures || 'recompute_friendship_stats left stats null after explicit call';
    end if;
    if v_shared_streak < 1 then
      failures := failures || format(
        'shared-streak one-member-completes: expected shared_streak >= 1 (yesterday %s counts because client_a completed, client_b merely rested) got %s',
        v_yesterday, v_shared_streak
      );
    end if;

    delete from public.workout_logs where client_id in (client_a, client_b);
  else
    failures := failures || 'shared-streak fixture skipped: current_date is before the 2026-06-29 fixture start_date, adjust fixture dates forward';
  end if;

  -------------------------------------------------------------------------
  -- Report
  -------------------------------------------------------------------------

  raise exception 'WAVE3_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
