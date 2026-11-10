-- Tell a client when their coach assigns a program or changes their schedule.
--
-- Producer only; the existing send-notifications consumer delivers it.
--
-- Why triggers rather than editing each write RPC: a coach's change reaches a
-- client through several RPCs (assign_program, save_client_program,
-- save_session, apply_session_to_future) and any later writer would be one more
-- place to forget. The rows that actually change what the client sees are
-- assignments, sessions and session_exercises, so the guard sits there (N1: a
-- producer is only worth having if nothing can change the schedule without it).
--
-- Tier: reads Schedule-tier rows, writes only notification_outbox. No client
-- data is touched.
--
-- One unsent row per client: a coach who edits five days in a sitting produces
-- one push, not five. The row waits a couple of minutes before it is due, and
-- every further edit before it is sent folds into it.

create unique index notification_outbox_one_unsent_schedule_update
  on public.notification_outbox (profile_id)
  where kind = 'schedule_updated' and sent_at is null;

-- ---------------------------------------------------------------------------
-- queue_schedule_update
-- ---------------------------------------------------------------------------

create function public.queue_schedule_update(p_client_id uuid, p_change text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Only a coach's change is news. No actor means cron or the service role
  -- (maintenance), and a client editing their own schedule already knows.
  if v_actor is null or v_actor = p_client_id then
    return;
  end if;

  -- Ids and a verb, never rendered text: the schedule can change again before
  -- this is delivered (N3).
  insert into public.notification_outbox (profile_id, kind, payload, next_attempt_at)
  values (
    p_client_id,
    'schedule_updated',
    jsonb_build_object('change', p_change),
    now() + interval '2 minutes'
  )
  on conflict (profile_id) where kind = 'schedule_updated' and sent_at is null
  do update set payload = case
    -- A brand-new program outranks "edited" within the same window.
    when public.notification_outbox.payload->>'change' = 'assigned'
      then public.notification_outbox.payload
    else excluded.payload
  end;
end;
$$;

comment on function public.queue_schedule_update(uuid, text) is
  'Queues (or folds into the client''s existing unsent) schedule_updated outbox row, change = assigned | edited. A no-op unless the caller is somebody other than the client, so cron, service-role maintenance and a client''s own edits never notify. Due after a short delay so one editing session is one push.';

revoke execute on function public.queue_schedule_update(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.trg_queue_schedule_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_client_id uuid;
begin
  if tg_table_name = 'assignments' then
    perform public.queue_schedule_update(v_row.client_id, 'assigned');
    return null;
  end if;

  -- sessions and session_exercises: walk up to the owning program. A template
  -- program has no client, so editing a template notifies nobody.
  if tg_table_name = 'sessions' then
    select p.client_id into v_client_id
    from public.programs p
    where p.id = coalesce(
      v_row.program_id,
      (select ph.program_id from public.program_phases ph where ph.id = v_row.phase_id)
    );
  else
    select p.client_id into v_client_id
    from public.sessions s
    join public.programs p on p.id = coalesce(
      s.program_id,
      (select ph.program_id from public.program_phases ph where ph.id = s.phase_id)
    )
    where s.id = v_row.session_id;
  end if;

  if v_client_id is not null then
    perform public.queue_schedule_update(v_client_id, 'edited');
  end if;
  return null;
end;
$$;

comment on function public.trg_queue_schedule_update() is
  'AFTER trigger on assignments (insert) and on sessions / session_exercises (insert, update, delete): resolves the owning client through the program and queues a schedule_updated notification. Template edits have no client and queue nothing.';

revoke execute on function public.trg_queue_schedule_update() from public, anon, authenticated;

create trigger queue_schedule_update_on_assignments
  after insert on public.assignments
  for each row execute function public.trg_queue_schedule_update();

create trigger queue_schedule_update_on_sessions
  after insert or update or delete on public.sessions
  for each row execute function public.trg_queue_schedule_update();

create trigger queue_schedule_update_on_session_exercises
  after insert or update or delete on public.session_exercises
  for each row execute function public.trg_queue_schedule_update();
