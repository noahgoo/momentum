-- Momentum development seed data.
--
-- Run as: supabase db query -f supabase/seed.sql   (postgres role, hosted dev
-- project). No service-role key / Auth Admin API used — auth.users +
-- auth.identities are inserted directly so GoTrue password login works for
-- every seeded account (password: "password123" for all).
--
-- Idempotent: every insert is keyed on a fixed UUID with ON CONFLICT DO
-- NOTHING (or upsert where a value legitimately needs refreshing on re-run,
-- e.g. client_summaries via the trigger/refresh functions). Safe to re-run
-- against the same project any number of times.
--
-- Dates are relative to current_date so streak/assignment states hold
-- whenever this is applied.
--
-- ============================================================================
-- ACCOUNTS (all passwords: password123)
-- ============================================================================
--  coach1@momentum.test   Sarah Coach    role=coach   (clients 1-7)
--  coach2@momentum.test   Marcus Coach   role=coach   (clients 8-10)
--  client1@momentum.test  Ava Client     invited_by=coach1  tz=America/New_York
--  client2@momentum.test  Ben Client     invited_by=coach1  tz=America/New_York
--  client3@momentum.test  Cara Client    invited_by=coach1  tz=America/Los_Angeles
--  client4@momentum.test  Deshawn Client invited_by=coach1  tz=America/Los_Angeles
--  client5@momentum.test  Elena Client   invited_by=coach1  tz=Europe/London
--  client6@momentum.test  Felix Client   invited_by=coach1  tz=America/New_York
--  client7@momentum.test  Grace Client   invited_by=coach1  tz=America/New_York  DISABLED
--  client8@momentum.test  Hana Client    invited_by=coach2  tz=America/Los_Angeles
--  client9@momentum.test  Ibrahim Client invited_by=coach2  tz=Europe/London
--  client10@momentum.test Jae Client     invited_by=coach2  tz=America/New_York
--
-- Expected streak state after apply (see client_summaries verification
-- query at the end of this file):
--  client1: active schedule-aware streak, perfect completion to date, today
--           left incomplete when scheduled (grace covers it).
--  client2: Simple program started this week, one completed log so far.
--  client3: broken streak. The missed day (v_missed3 in the script) is
--           computed, not hardcoded: it's the most recent ACTUAL scheduled
--           mon/wed/fri that is >= 2 days before current_date and after her
--           start (current_date - 10) -- guaranteeing it's a real scheduled
--           day, not a rest day, so the streak genuinely breaks there. Every
--           other scheduled day (before and after the miss) is completed;
--           the day at current_date - 1 additionally carries
--           difficulty='challenging' + next_day_feel=4.
--           Expected streak = (number of days from v_missed3 + 1 through
--           yesterday, inclusive) + 1 more if today is unscheduled or
--           already completed (compute_streak's grace: today only extends
--           the streak when it's NOT a scheduled-and-incomplete day; when it
--           IS scheduled-and-incomplete, the walk starts at yesterday
--           instead, so today contributes 0 either way -- the count from
--           v_missed3 + 1 through yesterday is unaffected by today's
--           status). Concretely: streak = (current_date - v_missed3 - 1) if
--           today is scheduled-and-incomplete, else (current_date -
--           v_missed3), since rest days between the miss and today never
--           break the count.
--  client4-6, client9-10: no assignment -> has_program=false, streak from
--           plain-consecutive fallback (0, no logs).
--  client7: disabled, old inactive assignment only, not counted anywhere
--           meaningful.
--  client8: active on coach2's program, has_program=true, no logs yet ->
--           streak 0 (today likely scheduled+incomplete -> grace -> still 0
--           since no prior days exist).
--
-- ============================================================================

do $$
declare
  -- Coaches
  coach1 uuid := '00000000-0000-0000-0000-000000000001';
  coach2 uuid := '00000000-0000-0000-0000-000000000002';

  -- Clients
  client1 uuid := '00000000-0000-0000-0000-000000000011';
  client2 uuid := '00000000-0000-0000-0000-000000000012';
  client3 uuid := '00000000-0000-0000-0000-000000000013';
  client4 uuid := '00000000-0000-0000-0000-000000000014';
  client5 uuid := '00000000-0000-0000-0000-000000000015';
  client6 uuid := '00000000-0000-0000-0000-000000000016';
  client7 uuid := '00000000-0000-0000-0000-000000000017';
  client8 uuid := '00000000-0000-0000-0000-000000000018';
  client9 uuid := '00000000-0000-0000-0000-000000000019';
  client10 uuid := '00000000-0000-0000-0000-000000000020';

  -- Exercises (coach1: 10, mixed modes/categories)
  ex1_squat uuid := '00000000-0000-0000-0000-000000000101';
  ex1_pushup uuid := '00000000-0000-0000-0000-000000000102';
  ex1_row uuid := '00000000-0000-0000-0000-000000000103';
  ex1_plank uuid := '00000000-0000-0000-0000-000000000104';
  ex1_lunge uuid := '00000000-0000-0000-0000-000000000105';
  ex1_run uuid := '00000000-0000-0000-0000-000000000106';
  ex1_bike uuid := '00000000-0000-0000-0000-000000000107';
  ex1_jump uuid := '00000000-0000-0000-0000-000000000108';
  ex1_stretch_hamstring uuid := '00000000-0000-0000-0000-000000000109';
  ex1_stretch_hip uuid := '00000000-0000-0000-0000-000000000110';

  -- Exercises (coach2: 4)
  ex2_deadlift uuid := '00000000-0000-0000-0000-000000000121';
  ex2_press uuid := '00000000-0000-0000-0000-000000000122';
  ex2_row uuid := '00000000-0000-0000-0000-000000000123';
  ex2_run uuid := '00000000-0000-0000-0000-000000000124';

  -- Workouts (coach1)
  w1_warmup uuid := '00000000-0000-0000-0000-000000000201';
  w1_fullbody uuid := '00000000-0000-0000-0000-000000000202';
  w1_cardio uuid := '00000000-0000-0000-0000-000000000203';

  -- Workout (coach2)
  w2_strength uuid := '00000000-0000-0000-0000-000000000211';

  -- Programs (coach1)
  prog1_foundation uuid := '00000000-0000-0000-0000-000000000301';
  prog1_simple uuid := '00000000-0000-0000-0000-000000000302';
  phase1a uuid := '00000000-0000-0000-0000-000000000311';
  phase1b uuid := '00000000-0000-0000-0000-000000000312';

  -- Program (coach2)
  prog2_basic uuid := '00000000-0000-0000-0000-000000000321';

  -- Assignments
  a_client1 uuid := '00000000-0000-0000-0000-000000000401';
  a_client2 uuid := '00000000-0000-0000-0000-000000000402';
  a_client3 uuid := '00000000-0000-0000-0000-000000000403';
  a_client7_old uuid := '00000000-0000-0000-0000-000000000407';
  a_client8 uuid := '00000000-0000-0000-0000-000000000408';

  -- Goals
  g_client1_locked uuid := '00000000-0000-0000-0000-000000000501';
  g_client1_own1 uuid := '00000000-0000-0000-0000-000000000502';
  g_client1_own2 uuid := '00000000-0000-0000-0000-000000000503';
  g_client2_own1 uuid := '00000000-0000-0000-0000-000000000504';
  g_client2_own2 uuid := '00000000-0000-0000-0000-000000000505';
  g_client3_active uuid := '00000000-0000-0000-0000-000000000506';
  g_client3_archived uuid := '00000000-0000-0000-0000-000000000507';

  -- Threads
  th_client1 uuid := '00000000-0000-0000-0000-000000000601';
  th_client3 uuid := '00000000-0000-0000-0000-000000000602';
  th_client8 uuid := '00000000-0000-0000-0000-000000000603';

  -- Change request
  cr_client1 uuid := '00000000-0000-0000-0000-000000000701';

  -- Workout logs (client1: perfect completion; client2: one log;
  -- client3: broken streak with detail)
  wl_c1_d0 uuid; wl_c1_d1 uuid; wl_c1_d2 uuid;
  wl_c2_d0 uuid;
  wl_c3_before uuid; wl_c3_missed uuid; wl_c3_after uuid;

  -- working vars
  v_start1 date := current_date - 21; -- client1: mid-program (3 weeks in)
  v_start2 date := date_trunc('week', current_date)::date; -- client2: this week (Monday)
  v_start3 date := current_date - 10; -- client3: 10 days ago
  v_missed3 date; -- client3: most recent actual scheduled day, >=2 days ago, that she misses
  v_day day_of_week;
  v_d date;
  v_i int;
  v_el uuid;
  v_pair_id text;
begin

  -- ==========================================================================
  -- AUTH USERS + IDENTITIES
  -- ==========================================================================

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values
    (coach1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'coach1@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Sarah Coach', 'role', 'coach'),
     now(), now()),
    (coach2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'coach2@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Marcus Coach', 'role', 'coach'),
     now(), now()),
    (client1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client1@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Ava Client', 'role', 'client', 'invited_by', coach1::text),
     now(), now()),
    (client2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client2@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Ben Client', 'role', 'client', 'invited_by', coach1::text),
     now(), now()),
    (client3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client3@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Cara Client', 'role', 'client', 'invited_by', coach1::text),
     now(), now()),
    (client4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client4@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Deshawn Client', 'role', 'client', 'invited_by', coach1::text),
     now(), now()),
    (client5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client5@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Elena Client', 'role', 'client', 'invited_by', coach1::text),
     now(), now()),
    (client6, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client6@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Felix Client', 'role', 'client', 'invited_by', coach1::text),
     now(), now()),
    (client7, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client7@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Grace Client', 'role', 'client', 'invited_by', coach1::text),
     now(), now()),
    (client8, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client8@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Hana Client', 'role', 'client', 'invited_by', coach2::text),
     now(), now()),
    (client9, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client9@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Ibrahim Client', 'role', 'client', 'invited_by', coach2::text),
     now(), now()),
    (client10, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'client10@momentum.test', crypt('password123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('display_name', 'Jae Client', 'role', 'client', 'invited_by', coach2::text),
     now(), now())
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  )
  select
    gen_random_uuid(), u.id, u.id::text, 'email',
    jsonb_build_object('sub', u.id::text, 'email', u.email),
    now(), now(), now()
  from auth.users u
  where u.id in (
    coach1, coach2, client1, client2, client3, client4, client5, client6, client7, client8, client9, client10
  )
  and not exists (
    select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
  );

  -- ==========================================================================
  -- PROFILES
  -- (The 0010 signup trigger already inserted base rows from raw_user_meta_data
  -- on the auth.users insert above; here we upsert the remaining fields —
  -- timezone, notification_time, disabled, height/sex for BF calc — that
  -- aren't part of signup metadata.)
  -- ==========================================================================

  update public.profiles set timezone = 'America/New_York', notification_time = '07:30' where id = coach1;
  update public.profiles set timezone = 'America/Los_Angeles', notification_time = '08:00' where id = coach2;

  update public.profiles set
    timezone = 'America/New_York', notification_time = '06:30',
    sex = 'male', height_in = 70
  where id = client1;

  update public.profiles set
    timezone = 'America/New_York', notification_time = '07:00'
  where id = client2;

  update public.profiles set
    timezone = 'America/Los_Angeles', notification_time = '17:00'
  where id = client3;

  update public.profiles set timezone = 'America/Los_Angeles', notification_time = '06:00' where id = client4;
  update public.profiles set timezone = 'Europe/London', notification_time = '18:30' where id = client5;
  update public.profiles set timezone = 'America/New_York', notification_time = '07:00' where id = client6;
  update public.profiles set timezone = 'America/New_York', disabled = true where id = client7;
  update public.profiles set timezone = 'America/Los_Angeles', notification_time = '09:00' where id = client8;
  update public.profiles set timezone = 'Europe/London', notification_time = '19:00' where id = client9;
  update public.profiles set timezone = 'America/New_York', notification_time = '06:45' where id = client10;

  -- ==========================================================================
  -- EXERCISES
  -- ==========================================================================

  insert into public.exercises (id, name, category, default_mode, default_sets, default_reps, default_duration_seconds, default_miles, created_by)
  values
    (ex1_squat, 'Bodyweight Squat', 'strength', 'reps', 3, 12, null, null, coach1),
    (ex1_pushup, 'Push-Up', 'strength', 'reps', 3, 10, null, null, coach1),
    (ex1_row, 'Dumbbell Row', 'strength', 'reps', 3, 10, null, null, coach1),
    (ex1_plank, 'Plank Hold', 'strength', 'time', 3, null, 45, null, coach1),
    (ex1_lunge, 'Walking Lunge', 'strength', 'reps', 3, 12, null, null, coach1),
    (ex1_run, 'Easy Run', 'cardio', 'distance', 1, null, null, 2, coach1),
    (ex1_bike, 'Stationary Bike', 'cardio', 'time', 1, null, 900, null, coach1),
    (ex1_jump, 'Jumping Jacks', 'cardio', 'time', 3, null, 60, null, coach1),
    (ex1_stretch_hamstring, 'Hamstring Stretch', 'flexibility', 'time', 2, null, 30, null, coach1),
    (ex1_stretch_hip, 'Hip Flexor Stretch', 'flexibility', 'time', 2, null, 30, null, coach1),
    (ex2_deadlift, 'Deadlift', 'strength', 'reps', 4, 8, null, null, coach2),
    (ex2_press, 'Overhead Press', 'strength', 'reps', 4, 8, null, null, coach2),
    (ex2_row, 'Barbell Row', 'strength', 'reps', 4, 8, null, null, coach2),
    (ex2_run, 'Tempo Run', 'cardio', 'distance', 1, null, null, 3, coach2)
  on conflict (id) do nothing;

  -- ==========================================================================
  -- WORKOUTS
  -- ==========================================================================

  insert into public.workouts (id, name, description, estimated_duration_minutes, type, created_by)
  values
    (w1_warmup, 'Dynamic Warmup', 'Loosen up before training.', 8, 'warmup', coach1),
    (w1_fullbody, 'Full Body Strength', 'Squats, push-ups, rows, lunges, plank.', 40, 'workout', coach1),
    (w1_cardio, 'Cardio Intervals', 'Run + bike + jumping jacks.', 35, 'workout', coach1)
  on conflict (id) do nothing;

  update public.workouts set warmup_id = w1_warmup where id = w1_fullbody;

  insert into public.workouts (id, name, description, estimated_duration_minutes, type, created_by)
  values
    (w2_strength, 'Coach2 Strength Basics', 'Deadlift, press, row.', 45, 'workout', coach2)
  on conflict (id) do nothing;

  -- Workout exercises: w1_fullbody (reps-mode)
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_fullbody, ex1_squat, 1, 'reps',
    '[{"reps":12,"weight":null,"weight_unit":null},{"reps":12,"weight":null,"weight_unit":null},{"reps":10,"weight":null,"weight_unit":null}]'::jsonb,
    60
  where not exists (select 1 from public.workout_exercises where workout_id = w1_fullbody and sort_order = 1);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_fullbody, ex1_pushup, 2, 'reps',
    '[{"reps":10,"weight":null,"weight_unit":null},{"reps":10,"weight":null,"weight_unit":null},{"reps":8,"weight":null,"weight_unit":null}]'::jsonb,
    60
  where not exists (select 1 from public.workout_exercises where workout_id = w1_fullbody and sort_order = 2);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_fullbody, ex1_row, 3, 'reps',
    '[{"reps":10,"weight":20,"weight_unit":"lbs"},{"reps":10,"weight":20,"weight_unit":"lbs"},{"reps":10,"weight":20,"weight_unit":"lbs"}]'::jsonb,
    60
  where not exists (select 1 from public.workout_exercises where workout_id = w1_fullbody and sort_order = 3);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_fullbody, ex1_lunge, 4, 'reps',
    '[{"reps":12,"weight":null,"weight_unit":null},{"reps":12,"weight":null,"weight_unit":null}]'::jsonb,
    45
  where not exists (select 1 from public.workout_exercises where workout_id = w1_fullbody and sort_order = 4);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_fullbody, ex1_plank, 5, 'time',
    '[{"seconds":45},{"seconds":45},{"seconds":30}]'::jsonb,
    30
  where not exists (select 1 from public.workout_exercises where workout_id = w1_fullbody and sort_order = 5);

  -- Workout exercises: w1_cardio (time + distance mode mix)
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_cardio, ex1_run, 1, 'distance',
    '[{"miles":2,"pace_seconds":540}]'::jsonb,
    120
  where not exists (select 1 from public.workout_exercises where workout_id = w1_cardio and sort_order = 1);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_cardio, ex1_bike, 2, 'time',
    '[{"seconds":900}]'::jsonb,
    60
  where not exists (select 1 from public.workout_exercises where workout_id = w1_cardio and sort_order = 2);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_cardio, ex1_jump, 3, 'time',
    '[{"seconds":60},{"seconds":60},{"seconds":45}]'::jsonb,
    30
  where not exists (select 1 from public.workout_exercises where workout_id = w1_cardio and sort_order = 3);

  -- Workout exercises: w1_warmup (time mode)
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_warmup, ex1_stretch_hamstring, 1, 'time',
    '[{"seconds":30},{"seconds":30}]'::jsonb,
    15
  where not exists (select 1 from public.workout_exercises where workout_id = w1_warmup and sort_order = 1);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w1_warmup, ex1_stretch_hip, 2, 'time',
    '[{"seconds":30},{"seconds":30}]'::jsonb,
    15
  where not exists (select 1 from public.workout_exercises where workout_id = w1_warmup and sort_order = 2);

  -- Workout exercises: w2_strength (coach2)
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w2_strength, ex2_deadlift, 1, 'reps',
    '[{"reps":8,"weight":95,"weight_unit":"lbs"},{"reps":8,"weight":95,"weight_unit":"lbs"},{"reps":6,"weight":105,"weight_unit":"lbs"},{"reps":6,"weight":105,"weight_unit":"lbs"}]'::jsonb,
    90
  where not exists (select 1 from public.workout_exercises where workout_id = w2_strength and sort_order = 1);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w2_strength, ex2_press, 2, 'reps',
    '[{"reps":8,"weight":45,"weight_unit":"lbs"},{"reps":8,"weight":45,"weight_unit":"lbs"},{"reps":6,"weight":50,"weight_unit":"lbs"},{"reps":6,"weight":50,"weight_unit":"lbs"}]'::jsonb,
    90
  where not exists (select 1 from public.workout_exercises where workout_id = w2_strength and sort_order = 2);

  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs, rest_seconds)
  select w2_strength, ex2_row, 3, 'reps',
    '[{"reps":8,"weight":40,"weight_unit":"lbs"},{"reps":8,"weight":40,"weight_unit":"lbs"},{"reps":8,"weight":40,"weight_unit":"lbs"},{"reps":8,"weight":40,"weight_unit":"lbs"}]'::jsonb,
    60
  where not exists (select 1 from public.workout_exercises where workout_id = w2_strength and sort_order = 3);

  -- ==========================================================================
  -- PROGRAMS
  -- ==========================================================================

  -- coach1 "Foundation": 4 weeks, 2 phases of 2 weeks each, phase-level
  -- schedules, active on mon/wed/fri.
  insert into public.programs (id, name, description, weeks, created_by)
  values (prog1_foundation, 'Foundation', 'Four-week onboarding program.', 4, coach1)
  on conflict (id) do nothing;

  insert into public.program_phases (id, program_id, name, sort_order, weeks, active_days)
  values
    (phase1a, prog1_foundation, 'Phase 1: Build the Habit', 1, 2, '{monday,wednesday,friday}'::day_of_week[]),
    (phase1b, prog1_foundation, 'Phase 2: Increase Load', 2, 2, '{monday,wednesday,friday}'::day_of_week[])
  on conflict (id) do nothing;

  -- Phase 1 weeks 1-2: mon=fullbody, wed=cardio, fri=fullbody
  insert into public.week_schedules (phase_id, week_number, day_of_week, workout_id)
  select phase1a, wk, d.day_of_week, case d.day_of_week when 'wednesday' then w1_cardio else w1_fullbody end
  from generate_series(1, 2) as wk
  cross join (values ('monday'::day_of_week), ('wednesday'::day_of_week), ('friday'::day_of_week)) as d(day_of_week)
  where not exists (
    select 1 from public.week_schedules ws
    where ws.phase_id = phase1a and ws.week_number = wk and ws.day_of_week = d.day_of_week
  );

  -- Phase 2 weeks 1-2 (global weeks 3-4): mon=fullbody, wed=cardio, fri=cardio
  insert into public.week_schedules (phase_id, week_number, day_of_week, workout_id)
  select phase1b, wk, d.day_of_week, case d.day_of_week when 'monday' then w1_fullbody else w1_cardio end
  from generate_series(1, 2) as wk
  cross join (values ('monday'::day_of_week), ('wednesday'::day_of_week), ('friday'::day_of_week)) as d(day_of_week)
  where not exists (
    select 1 from public.week_schedules ws
    where ws.phase_id = phase1b and ws.week_number = wk and ws.day_of_week = d.day_of_week
  );

  -- coach1 "Simple": 2 weeks flat, program-level schedule, mon/thu fullbody.
  insert into public.programs (id, name, description, weeks, created_by)
  values (prog1_simple, 'Simple', 'Two-week flat program, no phases.', 2, coach1)
  on conflict (id) do nothing;

  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id)
  select prog1_simple, wk, d.day_of_week, w1_fullbody
  from generate_series(1, 2) as wk
  cross join (values ('monday'::day_of_week), ('thursday'::day_of_week)) as d(day_of_week)
  where not exists (
    select 1 from public.week_schedules ws
    where ws.program_id = prog1_simple and ws.week_number = wk and ws.day_of_week = d.day_of_week
  );

  -- coach2 flat program, 2 weeks, tue/thu strength.
  insert into public.programs (id, name, description, weeks, created_by)
  values (prog2_basic, 'Coach2 Basics', 'Two-week flat program.', 2, coach2)
  on conflict (id) do nothing;

  insert into public.week_schedules (program_id, week_number, day_of_week, workout_id)
  select prog2_basic, wk, d.day_of_week, w2_strength
  from generate_series(1, 2) as wk
  cross join (values ('tuesday'::day_of_week), ('thursday'::day_of_week)) as d(day_of_week)
  where not exists (
    select 1 from public.week_schedules ws
    where ws.program_id = prog2_basic and ws.week_number = wk and ws.day_of_week = d.day_of_week
  );

  -- ==========================================================================
  -- ASSIGNMENTS
  -- ==========================================================================

  insert into public.assignments (id, client_id, program_id, start_date, active)
  values
    (a_client1, client1, prog1_foundation, v_start1, true),
    (a_client2, client2, prog1_simple, v_start2, true),
    (a_client3, client3, prog1_foundation, v_start3, true),
    (a_client8, client8, prog2_basic, current_date - 5, true)
  on conflict (id) do nothing;

  -- client7 (disabled): old inactive assignment only.
  insert into public.assignments (id, client_id, program_id, start_date, active)
  values (a_client7_old, client7, prog1_simple, current_date - 60, false)
  on conflict (id) do nothing;

  -- clients 4-6, 9-10 intentionally have no assignment.

  -- ==========================================================================
  -- WORKOUT LOGS
  -- ==========================================================================
  --
  -- Self-repairing: delete any existing workout_logs for the seeded clients
  -- across their seeded date ranges before inserting. This makes the
  -- log-seeding idempotent against *live data*, not just against its own
  -- prior inserts — if a previous run (or a bug in a previous version of
  -- this script) landed a log on the wrong day, re-running this file
  -- corrects it rather than leaving the stale row in place (ON CONFLICT DO
  -- NOTHING alone cannot do this, since the conflict key is (client_id,
  -- date) and a wrongly-present row for a "should be missing" date has no
  -- conflicting insert to no-op against). Deletes cascade to
  -- exercise_logs/set_logs (FK on delete cascade), so those are rebuilt too.

  delete from public.workout_logs where client_id = client1 and date between v_start1 and current_date;
  delete from public.workout_logs where client_id = client2 and date between v_start2 and current_date;
  delete from public.workout_logs where client_id = client3 and date between v_start3 and current_date;

  -- client3 (Cara): pick the most recent day she actually misses. Must be a
  -- real scheduled day (resolve_scheduled_workout not null), at least 2 days
  -- before current_date, and after her assignment start — otherwise (e.g. if
  -- that slot lands on a rest day) the streak wouldn't actually break, which
  -- is the bug this fix addresses.
  select max(d)::date into v_missed3
  from generate_series(v_start3 + 1, current_date - 2, interval '1 day') as d
  where public.resolve_scheduled_workout(client3, d::date) is not null;

  -- client1: perfect completion on every scheduled day from start_date up to
  -- (but not including) today. If today is itself scheduled, it is left
  -- incomplete on purpose (tests the streak grace day).
  for v_d in select generate_series(v_start1, current_date, interval '1 day')::date loop
    if public.resolve_scheduled_workout(client1, v_d) is not null and v_d < current_date then
      wl_c1_d0 := gen_random_uuid();
      insert into public.workout_logs (id, client_id, workout_id, date, completed, completed_at)
      values (wl_c1_d0, client1, public.resolve_scheduled_workout(client1, v_d), v_d, true, v_d + time '18:00')
      on conflict (client_id, date) do nothing;
    end if;
  end loop;

  -- Attach exercise_logs + set_logs to two of client1's completed logs for
  -- realistic detail (full-body log with reps sets).
  select id into wl_c1_d1 from public.workout_logs where client_id = client1 order by date desc limit 1;
  if wl_c1_d1 is not null then
    select workout_id into v_el from public.workout_logs where id = wl_c1_d1;
    if v_el = w1_fullbody then
      insert into public.exercise_logs (id, workout_log_id, exercise_id, exercise_name, mode, sort_order)
      select gen_random_uuid(), wl_c1_d1, ex1_squat, 'Bodyweight Squat', 'reps', 1
      where not exists (select 1 from public.exercise_logs where workout_log_id = wl_c1_d1 and sort_order = 1)
      returning id into v_el;

      if v_el is not null then
        insert into public.set_logs (exercise_log_id, set_number, reps, completed)
        values (v_el, 1, 12, true), (v_el, 2, 12, true), (v_el, 3, 10, true);
      end if;
    end if;
  end if;

  -- client2: one completed log with warmup_completed true.
  select public.resolve_scheduled_workout(client2, v_start2) into v_el;
  if v_el is not null then
    wl_c2_d0 := gen_random_uuid();
    insert into public.workout_logs (id, client_id, workout_id, date, completed, warmup_completed, completed_at)
    values (wl_c2_d0, client2, v_el, v_start2, true, true, v_start2 + time '07:30')
    on conflict (client_id, date) do nothing;
  end if;

  -- client3: completed every scheduled day except v_missed3 (broken streak),
  -- include a 'challenging' difficulty log and exercise/set detail with a
  -- distance-mode entry.
  for v_d in select generate_series(v_start3, current_date, interval '1 day')::date loop
    if public.resolve_scheduled_workout(client3, v_d) is not null and v_d < current_date then
      if v_missed3 is not null and v_d = v_missed3 then
        -- Deliberately missed: no workout_log row for this scheduled day.
        continue;
      end if;

      wl_c3_after := gen_random_uuid();
      insert into public.workout_logs (id, client_id, workout_id, date, completed, completed_at, difficulty, next_day_feel)
      values (
        wl_c3_after, client3, public.resolve_scheduled_workout(client3, v_d), v_d, true, v_d + time '19:00',
        case when v_d = current_date - 1 then 'challenging'::workout_difficulty else null end,
        case when v_d = current_date - 1 then 4 else null end
      )
      on conflict (client_id, date) do nothing;
    end if;
  end loop;

  -- Exercise/set logs for client3: one reps-mode log and one distance-mode log.
  select wl.id, wl.workout_id into wl_c3_before, v_el
  from public.workout_logs wl
  where wl.client_id = client3 and wl.workout_id = w1_fullbody
  order by wl.date desc limit 1;

  if wl_c3_before is not null then
    insert into public.exercise_logs (id, workout_log_id, exercise_id, exercise_name, mode, sort_order)
    select gen_random_uuid(), wl_c3_before, ex1_pushup, 'Push-Up', 'reps', 1
    where not exists (select 1 from public.exercise_logs where workout_log_id = wl_c3_before and sort_order = 1)
    returning id into v_el;

    if v_el is not null then
      insert into public.set_logs (exercise_log_id, set_number, reps, completed)
      values (v_el, 1, 10, true), (v_el, 2, 9, true), (v_el, 3, 7, true);
    end if;
  end if;

  select wl.id into wl_c3_missed
  from public.workout_logs wl
  where wl.client_id = client3 and wl.workout_id = w1_cardio
  order by wl.date desc limit 1;

  if wl_c3_missed is not null then
    insert into public.exercise_logs (id, workout_log_id, exercise_id, exercise_name, mode, sort_order)
    select gen_random_uuid(), wl_c3_missed, ex1_run, 'Easy Run', 'distance', 1
    where not exists (select 1 from public.exercise_logs where workout_log_id = wl_c3_missed and sort_order = 1)
    returning id into v_el;

    if v_el is not null then
      insert into public.set_logs (exercise_log_id, set_number, actual_miles, actual_seconds, completed)
      values (v_el, 1, 2.1, 1150, true);
    end if;
  end if;

  -- ==========================================================================
  -- GOALS
  -- ==========================================================================

  insert into public.goals (id, client_id, text, set_by, locked, active)
  values
    (g_client1_locked, client1, 'Drink 80oz of water daily', coach1, true, true),
    (g_client1_own1, client1, 'Stretch for 10 minutes', client1, false, true),
    (g_client1_own2, client1, 'No screens after 9pm', client1, false, true),
    (g_client2_own1, client2, 'Eat a vegetable at every meal', client2, false, true),
    (g_client2_own2, client2, 'Sleep 7+ hours', client2, false, true),
    (g_client3_active, client3, 'Log meals daily', client3, false, true)
  on conflict (id) do nothing;

  insert into public.goals (id, client_id, text, set_by, locked, active, archived_at, archived_by)
  values (g_client3_archived, client3, 'Meditate 5 minutes', client3, false, false, now() - interval '10 days', client3)
  on conflict (id) do nothing;

  -- goal_logs: client1 completed 2 of 3 today, full completion yesterday;
  -- scatter a week of partial logs across client1 and client2. Unlike
  -- workout_logs, every (goal_id, date) pair here is a fixed literal, not a
  -- computed "which day did she miss" value, so ON CONFLICT (goal_id, date)
  -- DO NOTHING is already self-repairing on re-run — there is no wrong-day
  -- state a delete-then-insert would need to correct.
  insert into public.goal_logs (client_id, goal_id, date, goal_text)
  values
    (client1, g_client1_locked, current_date, 'Drink 80oz of water daily'),
    (client1, g_client1_own1, current_date, 'Stretch for 10 minutes')
  on conflict (goal_id, date) do nothing;

  insert into public.goal_logs (client_id, goal_id, date, goal_text)
  values
    (client1, g_client1_locked, current_date - 1, 'Drink 80oz of water daily'),
    (client1, g_client1_own1, current_date - 1, 'Stretch for 10 minutes'),
    (client1, g_client1_own2, current_date - 1, 'No screens after 9pm')
  on conflict (goal_id, date) do nothing;

  -- Scatter partial logs over the rest of the past week for client1 + client2.
  for v_i in 2..6 loop
    insert into public.goal_logs (client_id, goal_id, date, goal_text)
    values (client1, g_client1_locked, current_date - v_i, 'Drink 80oz of water daily')
    on conflict (goal_id, date) do nothing;

    if v_i % 2 = 0 then
      insert into public.goal_logs (client_id, goal_id, date, goal_text)
      values (client1, g_client1_own1, current_date - v_i, 'Stretch for 10 minutes')
      on conflict (goal_id, date) do nothing;
    end if;

    insert into public.goal_logs (client_id, goal_id, date, goal_text)
    values (client2, g_client2_own1, current_date - v_i, 'Eat a vegetable at every meal')
    on conflict (goal_id, date) do nothing;
  end loop;

  -- ==========================================================================
  -- THREADS + MESSAGES
  -- ==========================================================================

  insert into public.threads (id, client_id, coach_id)
  values
    (th_client1, client1, coach1),
    (th_client3, client3, coach1),
    (th_client8, client8, coach2)
  on conflict (id) do nothing;

  -- coach1 <-> client1: 6 messages, last from client, unread for coach.
  insert into public.messages (thread_id, sender_id, text, sent_at, read)
  select th_client1, sender, txt, sent_at, true
  from (values
    (coach1, 'Hey Ava, how did the full body session feel yesterday?', now() - interval '2 days'),
    (client1, 'Pretty good! Legs were a bit sore but pushed through.', now() - interval '2 days' + interval '1 hour'),
    (coach1, 'Nice, that''s normal for week 3. Stay on top of the stretches.', now() - interval '1 day' - interval '20 hours'),
    (client1, 'Will do. Quick question, can I move Friday''s workout to Saturday?', now() - interval '1 day'),
    (coach1, 'Sure, go ahead and send the request from the app.', now() - interval '20 hours'),
    (client1, 'Just sent it, thanks!', now() - interval '2 hours')
  ) as m(sender, txt, sent_at)
  where not exists (select 1 from public.messages where thread_id = th_client1);

  update public.threads
  set last_message = 'Just sent it, thanks!', last_message_at = now() - interval '2 hours',
      last_message_by = client1, unread_for_coach = true, unread_for_client = false
  where id = th_client1;

  -- coach1 <-> client3: 2 messages, read.
  insert into public.messages (thread_id, sender_id, text, sent_at, read)
  select th_client3, sender, txt, sent_at, true
  from (values
    (coach1, 'Saw you missed Wednesday, everything okay?', now() - interval '2 days'),
    (client3, 'Yeah just a busy day, back on track now.', now() - interval '2 days' + interval '3 hours')
  ) as m(sender, txt, sent_at)
  where not exists (select 1 from public.messages where thread_id = th_client3);

  update public.threads
  set last_message = 'Yeah just a busy day, back on track now.', last_message_at = now() - interval '2 days' + interval '3 hours',
      last_message_by = client3, unread_for_coach = false, unread_for_client = false
  where id = th_client3;

  -- coach2 <-> client8: 1 message.
  insert into public.messages (thread_id, sender_id, text, sent_at, read)
  select th_client8, coach2, 'Welcome aboard, Hana! Let me know if you have questions.', now() - interval '4 days', true
  where not exists (select 1 from public.messages where thread_id = th_client8);

  update public.threads
  set last_message = 'Welcome aboard, Hana! Let me know if you have questions.',
      last_message_at = now() - interval '4 days', last_message_by = coach2,
      unread_for_coach = false, unread_for_client = true
  where id = th_client8;

  -- ==========================================================================
  -- FRIENDSHIPS
  -- ==========================================================================

  -- client1 + client2: accepted. pair_id/coach_id/member_names computed by
  -- the BEFORE INSERT trigger (0013).
  if not exists (
    select 1 from public.friendships
    where (client_id = client1 and friend_id = client2) or (client_id = client2 and friend_id = client1)
  ) then
    insert into public.friendships (client_id, friend_id, requested_by, status)
    values (client1, client2, client1, 'pending');
  end if;

  v_pair_id := least(client1::text, client2::text) || '_' || greatest(client1::text, client2::text);
  update public.friendships
  set status = 'accepted', accepted_at = now() - interval '5 days'
  where pair_id = v_pair_id and status <> 'accepted';

  -- client2 -> client3: pending.
  if not exists (
    select 1 from public.friendships
    where (client_id = client2 and friend_id = client3) or (client_id = client3 and friend_id = client2)
  ) then
    insert into public.friendships (client_id, friend_id, requested_by, status)
    values (client2, client3, client2, 'pending');
  end if;

  -- ==========================================================================
  -- MOTIVATION
  -- ==========================================================================

  insert into public.motivation_entries (quote, week_start, created_by)
  select 'Discipline is choosing between what you want now and what you want most.',
    date_trunc('week', current_date)::date, coach1
  where not exists (
    select 1 from public.motivation_entries
    where created_by = coach1 and week_start = date_trunc('week', current_date)::date
  );

  insert into public.motivation_entries (quote, week_start, created_by)
  select 'Small steps every day beat big leaps once in a while.',
    date_trunc('week', current_date)::date, coach2
  where not exists (
    select 1 from public.motivation_entries
    where created_by = coach2 and week_start = date_trunc('week', current_date)::date
  );

  -- ==========================================================================
  -- CHANGE REQUEST (client1, pending)
  -- ==========================================================================

  declare
    v_from_date date;
    v_to_date date;
    v_workout_id uuid;
  begin
    select min(d)::date into v_from_date
    from generate_series(current_date, current_date + 14, interval '1 day') as d
    where public.resolve_scheduled_workout(client1, d::date) is not null;

    if v_from_date is not null then
      v_to_date := v_from_date + 1;
      v_workout_id := public.resolve_scheduled_workout(client1, v_from_date);

      insert into public.change_requests (id, client_id, coach_id, from_date, to_date, workout_id, status)
      values (cr_client1, client1, coach1, v_from_date, v_to_date, v_workout_id, 'pending')
      on conflict (id) do nothing;
    end if;
  end;

  -- ==========================================================================
  -- BODY MEASUREMENTS
  -- ==========================================================================

  -- client1: 4 weekly entries, weight trending down, neck/waist present for
  -- Navy body-fat calc (sex=male, height set on profile above).
  insert into public.body_measurements (client_id, date, weight_lbs, neck_in, waist_in, chest_in, arm_in, thigh_in)
  values
    (client1, current_date - 21, 190, 15.5, 36, 42, 14, 23),
    (client1, current_date - 14, 188, 15.4, 35.5, 42, 14, 23),
    (client1, current_date - 7, 186, 15.3, 35, 42.5, 14.2, 23),
    (client1, current_date, 184, 15.2, 34.5, 43, 14.2, 23)
  on conflict (client_id, date) do nothing;

  insert into public.body_measurements (client_id, date, weight_lbs, waist_in, hips_in)
  values (client2, current_date - 3, 165, 33, 38)
  on conflict (client_id, date) do nothing;

  -- ==========================================================================
  -- SUMMARIES REFRESH
  -- ==========================================================================

  perform public.refresh_all_client_summaries();

  perform public.recompute_friendship_stats(v_pair_id);

end $$;

-- ==============================================================================
-- VERIFICATION
-- ==============================================================================

select
  p.email,
  cs.display_name,
  cs.disabled,
  cs.has_program,
  cs.today_workout_name,
  cs.workout_done,
  cs.active_goal_count,
  cs.goals_completed_today,
  cs.streak,
  cs.unread_for_coach,
  cs.last_message_at
from public.client_summaries cs
join public.profiles p on p.id = cs.client_id
order by p.email;
