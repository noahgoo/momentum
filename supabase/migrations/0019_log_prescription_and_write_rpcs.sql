-- Phase 1c of the ruleset remediation (docs/rules/violations.md B7, M-1, W-1,
-- and the write half of P-1).
--
-- Three multi-row writes currently run as sequences of separate PostgREST
-- calls with no transaction, so a dropped connection midway leaves the data
-- inconsistent:
--
--   B7  useSaveWorkoutLog: upsert log -> delete set_logs -> delete
--       exercise_logs -> LOOP inserting a row per exercise and per set.
--       Failing inside the loop leaves a completed workout with its children
--       destroyed and nothing to roll back to.
--   M-1 useSendMessage (both apps): insert thread -> insert message ->
--       update thread. Failing after the message insert stores the message
--       but never flips unread_for_coach, so the coach never sees it.
--   W-1 useWarmupToggle: a full-row upsert on (client_id, date) — the same
--       conflict key useSaveWorkoutLog upserts with a different column set.
--       Two creators for one row, and no check that the date is scheduled,
--       so a rest day could get a stub log.
--
-- Each becomes one SECURITY DEFINER function: one round trip, one
-- transaction. Per docs/rules/data-model.md R2.
--
-- P-1 (write half): exercise_logs/set_logs gain a `prescribed` jsonb so a log
-- carries the targets it was recorded against. History then renders from the
-- log alone and stops changing when a coach edits the workout. The snapshot
-- is captured inside save_workout_log so no caller can forget it.

-- ---------------------------------------------------------------------------
-- Prescription snapshot columns (P-1, docs/rules/workout-numbers.md P1)
-- ---------------------------------------------------------------------------

alter table public.exercise_logs add column prescribed jsonb;
alter table public.set_logs add column prescribed jsonb;
alter table public.set_logs add column weight_entered boolean not null default false;

comment on column public.exercise_logs.prescribed is
  'Snapshot of the exercise''s set_configs as they stood when this log was recorded. History renders from this, never from a live workout_exercises join — a coach editing the workout must not rewrite what a past log says the client was asked to do.';
comment on column public.set_logs.prescribed is
  'Snapshot of this set''s target {reps, weight, weight_unit, seconds, miles, pace_seconds} at log time. Paired with the set by row identity, not array position.';
comment on column public.set_logs.weight_entered is
  'True when the client actually typed a weight, false when they only checked the set off. Distinguishes "lifted 135" from "tapped the checkbox on a set targeting 135" — the target must never be recorded as the actual (docs/rules/workout-numbers.md P2).';

-- workout_logs.workout_id is provenance, not a dependency: history must
-- survive the workout being deleted. A bare `references` defaults to
-- NO ACTION, which fails the delete late and opaquely (R4).
alter table public.workout_logs
  drop constraint workout_logs_workout_id_fkey,
  add constraint workout_logs_workout_id_fkey
    foreign key (workout_id) references public.workouts (id) on delete set null;

-- ---------------------------------------------------------------------------
-- save_workout_log: the whole log tree in one transaction (B7)
-- ---------------------------------------------------------------------------

create function public.save_workout_log(
  p_date date,
  p_workout_id uuid,
  p_completed boolean,
  p_exercises jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
  v_log_id uuid;
  v_exercise jsonb;
  v_exercise_log_id uuid;
  v_set jsonb;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  -- A log may only exist for a date the client actually has a workout on.
  -- Checked only when creating: an existing log stays editable even if the
  -- coach later reschedules that date out from under it (the client did the
  -- work; the record stays).
  if not exists (
    select 1 from public.workout_logs
    where client_id = v_client_id and date = p_date
  ) and public.resolve_scheduled_workout(v_client_id, p_date) is null then
    raise exception 'not_scheduled';
  end if;

  -- warmup_completed is deliberately absent: it belongs to
  -- set_warmup_completed. One writer per column (docs/rules/notifications.md W1).
  insert into public.workout_logs (client_id, date, workout_id, completed, completed_at)
  values (
    v_client_id,
    p_date,
    p_workout_id,
    p_completed,
    case when p_completed then now() else null end
  )
  on conflict (client_id, date) do update set
    workout_id = excluded.workout_id,
    completed = excluded.completed,
    completed_at = excluded.completed_at
  returning id into v_log_id;

  -- Replace children wholesale. Safe here in a way the client-side version
  -- was not: this is one transaction, so a failure rolls the delete back
  -- rather than leaving the log stripped (R3 permits a full replace inside a
  -- SQL function).
  delete from public.exercise_logs where workout_log_id = v_log_id;

  for v_exercise in select * from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
  loop
    insert into public.exercise_logs (
      workout_log_id, exercise_id, exercise_name, mode, sort_order, prescribed
    )
    values (
      v_log_id,
      nullif(v_exercise->>'exercise_id', '')::uuid,
      coalesce(v_exercise->>'exercise_name', 'Exercise'),
      coalesce((v_exercise->>'mode')::public.exercise_mode, 'reps'),
      (v_exercise->>'sort_order')::int,
      v_exercise->'prescribed'
    )
    returning id into v_exercise_log_id;

    for v_set in select * from jsonb_array_elements(coalesce(v_exercise->'sets', '[]'::jsonb))
    loop
      insert into public.set_logs (
        exercise_log_id, set_number, completed, reps, weight, weight_unit,
        target_seconds, actual_seconds, actual_miles, prescribed, weight_entered
      )
      values (
        v_exercise_log_id,
        (v_set->>'set_number')::int,
        coalesce((v_set->>'completed')::boolean, false),
        (v_set->>'reps')::int,
        (v_set->>'weight')::numeric,
        (v_set->>'weight_unit')::public.weight_unit,
        (v_set->>'target_seconds')::int,
        (v_set->>'actual_seconds')::int,
        (v_set->>'actual_miles')::numeric,
        v_set->'prescribed',
        coalesce((v_set->>'weight_entered')::boolean, false)
      );
    end loop;
  end loop;

  return v_log_id;
end;
$$;

comment on function public.save_workout_log(date, uuid, boolean, jsonb) is
  'RPC: writes a client''s whole workout-log tree (log + exercise_logs + set_logs) in one transaction, snapshotting each exercise''s and set''s prescription. client_id is taken from auth.uid() and never as a parameter — a client logs only their own work. Refuses to CREATE a log for an unscheduled date (not_scheduled); an existing log stays editable. Never touches warmup_completed. Raises: forbidden, not_scheduled.';

revoke execute on function public.save_workout_log(date, uuid, boolean, jsonb) from public, anon;
grant execute on function public.save_workout_log(date, uuid, boolean, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- set_warmup_completed: the other writer of workout_logs (W-1)
-- ---------------------------------------------------------------------------

create function public.set_warmup_completed(p_date date, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := auth.uid();
  v_log_id uuid;
  v_workout_id uuid;
begin
  if v_client_id is null then
    raise exception 'forbidden';
  end if;

  select id into v_log_id
  from public.workout_logs
  where client_id = v_client_id and date = p_date;

  if v_log_id is not null then
    -- Patch by id, touching only this writer's column.
    update public.workout_logs set warmup_completed = p_completed where id = v_log_id;
    return;
  end if;

  -- No log yet: create a stub, but only for a date that actually has a
  -- workout. Without this a rest day could get a workout_logs row.
  v_workout_id := public.resolve_scheduled_workout(v_client_id, p_date);
  if v_workout_id is null then
    raise exception 'not_scheduled';
  end if;

  insert into public.workout_logs (client_id, date, workout_id, warmup_completed)
  values (v_client_id, p_date, v_workout_id, p_completed);
end;
$$;

comment on function public.set_warmup_completed(date, boolean) is
  'RPC: sets workout_logs.warmup_completed for the calling client, patching an existing row by id or creating a stub only when the date has a scheduled workout. Touches no other column — warm-up completion is independent of workout completion (docs/rules/notifications.md W2). Raises: forbidden, not_scheduled.';

revoke execute on function public.set_warmup_completed(date, boolean) from public, anon;
grant execute on function public.set_warmup_completed(date, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- send_message: message + thread denormalization atomically (M-1)
-- ---------------------------------------------------------------------------

create function public.send_message(p_thread_client_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid := auth.uid();
  v_is_coach boolean;
  v_thread public.threads%rowtype;
  v_coach_id uuid;
  v_message public.messages%rowtype;
begin
  if v_sender is null then
    raise exception 'forbidden';
  end if;

  if p_text is null or length(trim(p_text)) = 0 then
    raise exception 'empty_message';
  end if;

  v_is_coach := v_sender <> p_thread_client_id;

  -- A coach may write to their own client's thread; a client only to theirs.
  if v_is_coach then
    if not public.is_coach_of(p_thread_client_id) then
      raise exception 'no_thread_permission';
    end if;
    v_coach_id := v_sender;
  else
    select invited_by into v_coach_id from public.profiles where id = p_thread_client_id;
    if v_coach_id is null then
      raise exception 'no_thread_permission';
    end if;
  end if;

  select * into v_thread from public.threads where client_id = p_thread_client_id;

  if v_thread.id is null then
    insert into public.threads (client_id, coach_id)
    values (p_thread_client_id, v_coach_id)
    returning * into v_thread;
  end if;

  insert into public.messages (thread_id, sender_id, text)
  values (v_thread.id, v_sender, p_text)
  returning * into v_message;

  -- Denormalized thread fields and the unread flag move with the message, so
  -- a failure can never leave a stored message the recipient is not told about.
  update public.threads
  set last_message = p_text,
      last_message_at = v_message.sent_at,
      last_message_by = v_sender,
      unread_for_coach = case when v_is_coach then false else true end,
      unread_for_client = case when v_is_coach then true else false end
  where id = v_thread.id;

  return jsonb_build_object(
    'message_id', v_message.id,
    'thread_id', v_thread.id,
    'sent_at', v_message.sent_at
  );
end;
$$;

comment on function public.send_message(uuid, text) is
  'RPC: inserts a message and updates its thread''s denormalized last_message/unread flags in one transaction, creating the thread on first send. Sender is auth.uid(); serves both apps, setting the unread flag for whichever side did not send. Returns {message_id, thread_id, sent_at} so the caller reconciles against the server timestamp rather than a device clock. Raises: forbidden, empty_message, no_thread_permission.';

revoke execute on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;
