-- Assertions for 0047: a coach's assignment or schedule edit queues one
-- schedule_updated notification per client, folded while unsent; nothing is
-- queued for templates, the client's own edits, or cron.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0047_schedule_update_notifications_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  v_coach uuid := 'd8000000-0000-0000-0000-000000000001';
  client_a uuid := 'd8000000-0000-0000-0000-00000000000a';
  prog uuid := 'd8100000-0000-0000-0000-000000000001';
  ph uuid := 'd8200000-0000-0000-0000-000000000001';
  w_push uuid := 'd8300000-0000-0000-0000-000000000001';
  ex_row uuid := 'd8400000-0000-0000-0000-000000000001';

  v_session uuid;
  v_n int;
  v_row public.notification_outbox%rowtype;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_coach, 'sun-coach@test.local', jsonb_build_object('role','coach','display_name','Sun Coach')),
    (client_a, 'sun-a@test.local',
      jsonb_build_object('role','client','display_name','Sun A','invited_by',v_coach::text))
  on conflict (id) do nothing;

  insert into public.exercises (id, name, created_by) values (ex_row, 'Row', v_coach);
  insert into public.workouts (id, name, type, created_by) values (w_push, 'Push Day', 'workout', v_coach);
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, mode, set_configs)
  values (w_push, ex_row, 0, 'reps', '[{"reps":5,"weight":135,"weight_unit":"lbs"}]'::jsonb);
  insert into public.programs (id, name, weeks, created_by) values (prog, 'Sun Program', 2, v_coach);
  insert into public.program_phases (id, program_id, sort_order, weeks) values (ph, prog, 0, 2);

  -- No actor (cron/service role): building the template queues nothing.
  perform public.materialize_session(null, ph, 1, 'monday', w_push);

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach)::text, true);

  -- Editing a template notifies nobody.
  perform public.materialize_session(null, ph, 2, 'monday', w_push);
  update public.sessions set name = 'Renamed template day' where phase_id = ph and week_number = 2;
  select count(*) into v_n from public.notification_outbox where kind = 'schedule_updated';
  if v_n <> 0 then
    failures := array_append(failures, format('#1 template edits must queue nothing, got %s', v_n));
  end if;

  -- Assigning queues exactly one "assigned" row, though many rows were copied.
  perform public.assign_program(client_a, prog, date_trunc('week', current_date)::date);
  select count(*) into v_n from public.notification_outbox
  where profile_id = client_a and kind = 'schedule_updated' and sent_at is null;
  select * into v_row from public.notification_outbox where profile_id = client_a and kind = 'schedule_updated';
  if v_n <> 1 or v_row.payload->>'change' is distinct from 'assigned' then
    failures := array_append(failures, format('#2 assign should queue one assigned row, got %s / %s', v_n, v_row.payload));
  end if;
  if v_row.next_attempt_at <= now() then
    failures := array_append(failures, '#2 the row should be due a little later, so edits can fold into it');
  end if;

  -- A further edit before it is sent folds in and does not downgrade the verb.
  select s.id into v_session from public.sessions s
  join public.programs p on p.id = s.program_id or p.id = (select program_id from public.program_phases where id = s.phase_id)
  where p.client_id = client_a limit 1;
  update public.sessions set name = 'Edited for client' where id = v_session;
  update public.session_exercises set notes = 'brace' where session_id = v_session;
  select count(*) into v_n from public.notification_outbox where profile_id = client_a and kind = 'schedule_updated';
  select * into v_row from public.notification_outbox where profile_id = client_a and kind = 'schedule_updated';
  if v_n <> 1 or v_row.payload->>'change' is distinct from 'assigned' then
    failures := array_append(failures, format('#3 edits before sending must fold into one assigned row, got %s / %s', v_n, v_row.payload));
  end if;

  -- Once sent, the next edit is a new "edited" notification.
  update public.notification_outbox set sent_at = now() where id = v_row.id;
  update public.session_exercises set notes = 'brace harder' where session_id = v_session;
  select count(*) into v_n from public.notification_outbox
  where profile_id = client_a and kind = 'schedule_updated' and sent_at is null and payload->>'change' = 'edited';
  if v_n <> 1 then
    failures := array_append(failures, format('#4 an edit after sending should queue a fresh edited row, got %s', v_n));
  end if;

  -- The client's own edit is not news.
  update public.notification_outbox set sent_at = now() where profile_id = client_a and sent_at is null;
  perform set_config('request.jwt.claims', json_build_object('sub', client_a)::text, true);
  perform public.queue_schedule_update(client_a, 'edited');
  select count(*) into v_n from public.notification_outbox where profile_id = client_a and sent_at is null;
  if v_n <> 0 then
    failures := array_append(failures, '#5 a client''s own change must not queue a notification');
  end if;

  if cardinality(failures) > 0 then
    raise exception 'schedule update notification assertions FAILED: %', array_to_string(failures, E'\n  ');
  end if;
  raise notice 'schedule update notification assertions PASSED';
end;
$$;

rollback;
