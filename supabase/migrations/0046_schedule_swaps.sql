-- Schedule swaps: a client can trade two scheduled workouts with each other,
-- not only move one onto a rest day.
--
-- Tier: Schedule only. A swap writes assignment_date_overrides for one client
-- on two dates. No library row, no sessions row, and no Event row is touched;
-- a swap is refused when either date already has a log (R10).
--
-- A swap is TWO change_requests rows that share swap_id: A -> B and B -> A.
-- They are one decision: filed together, accepted or rejected together,
-- withdrawn together, applied in one transaction. Reusing the move rows keeps
-- the approval setting (profiles.move_approval), the coach inbox, history,
-- notifications and realtime exactly as they are.

alter table public.change_requests
  add column swap_id uuid;

comment on column public.change_requests.swap_id is
  'Set on both rows of a swap (A -> B and B -> A). Rows sharing a swap_id are decided, withdrawn and applied as one unit; NULL for an ordinary one-way move.';

create index change_requests_swap_id_idx on public.change_requests (swap_id) where swap_id is not null;

-- ---------------------------------------------------------------------------
-- apply_schedule_swap: internal. p_id is either row of a pending swap pair.
-- Returns NULL on success, or the reason it could not apply (both rows are
-- then stamped skipped). Everything is re-resolved live (C5).
-- ---------------------------------------------------------------------------

create function public.apply_schedule_swap(p_id uuid, p_decided_by uuid, p_auto boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_swap_id uuid;
  v_a public.change_requests%rowtype;
  v_b public.change_requests%rowtype;
  v_assignment_id uuid;
  v_session_a uuid;
  v_session_b uuid;
  v_reason text;
begin
  select swap_id into v_swap_id from public.change_requests where id = p_id;
  if v_swap_id is null then
    raise exception 'not_found_or_forbidden';
  end if;

  -- Lock both halves in a stable order so two concurrent decisions cannot
  -- deadlock. a is the earlier-filed half.
  select * into v_a from public.change_requests
  where swap_id = v_swap_id order by position, id limit 1 for update;
  select * into v_b from public.change_requests
  where swap_id = v_swap_id and id <> v_a.id for update;

  if v_a.id is null or v_b.id is null or v_a.status <> 'pending' or v_b.status <> 'pending' then
    raise exception 'not_found_or_forbidden';
  end if;

  v_assignment_id := public.assignment_in_force(v_a.client_id, v_a.from_date);
  v_session_a := public.resolve_scheduled_workout(v_a.client_id, v_a.from_date);
  v_session_b := public.resolve_scheduled_workout(v_a.client_id, v_b.from_date);

  if v_assignment_id is null or v_session_a is null or v_session_b is null then
    v_reason := 'nothing_to_move';
  elsif exists (
    select 1 from public.workout_logs wl
    where wl.client_id = v_a.client_id and wl.date in (v_a.from_date, v_b.from_date)
  ) then
    -- Event tier: a day the client already trained on is history.
    v_reason := 'already_logged';
  else
    -- Each side lands on a day the other is vacating.
    v_reason := coalesce(
      public.move_target_problem(v_a.client_id, v_a.from_date, v_a.to_date, array[v_a.to_date]),
      public.move_target_problem(v_b.client_id, v_b.from_date, v_b.to_date, array[v_b.to_date])
    );
  end if;

  if v_reason is not null then
    update public.change_requests
    set status = 'skipped', skip_reason = v_reason, responded_at = now(),
        decided_by = p_decided_by, auto_applied = p_auto
    where swap_id = v_swap_id;
    return v_reason;
  end if;

  insert into public.assignment_date_overrides (assignment_id, date, session_id)
  values (v_assignment_id, v_a.to_date, v_session_a),
         (v_assignment_id, v_b.to_date, v_session_b)
  on conflict (assignment_id, date) do update set session_id = excluded.session_id;

  update public.change_requests
  set status = 'accepted', responded_at = now(), decided_by = p_decided_by,
      auto_applied = p_auto, skip_reason = null
  where swap_id = v_swap_id;

  return null;
end;
$$;

comment on function public.apply_schedule_swap(uuid, uuid, boolean) is
  'Internal: applies one pending swap pair. Locks both rows, re-resolves both days live, refuses logged days, and requires both days to be in the same assignment and today or later (move_target_problem, with each side treated as vacated). Writes one override per date; neither session row is touched. Returns NULL on success or the skip reason (both rows stamped skipped). Raises not_found_or_forbidden when either row is no longer pending. Not reachable by any client role.';

revoke execute on function public.apply_schedule_swap(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- request_schedule_swap: client files a swap of two scheduled days
-- ---------------------------------------------------------------------------

create function public.request_schedule_swap(p_batch_id uuid, p_date_a date, p_date_b date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_session_a uuid;
  v_session_b uuid;
  v_problem text;
  v_swap_id uuid := gen_random_uuid();
  v_reason text;
begin
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null or v_profile.role <> 'client' or v_profile.disabled or v_profile.invited_by is null then
    raise exception 'forbidden';
  end if;

  if p_batch_id is null or p_date_a is null or p_date_b is null or p_date_a = p_date_b then
    raise exception 'invalid_moves';
  end if;

  -- C4: a retried submission does nothing the second time.
  if exists (select 1 from public.change_requests where batch_id = p_batch_id) then
    if exists (
      select 1 from public.change_requests where batch_id = p_batch_id and client_id <> v_uid
    ) then
      raise exception 'forbidden';
    end if;
    return jsonb_build_object('batch_id', p_batch_id, 'duplicate', true);
  end if;

  v_session_a := public.resolve_scheduled_workout(v_uid, p_date_a);
  v_session_b := public.resolve_scheduled_workout(v_uid, p_date_b);
  if v_session_a is null then
    raise exception 'nothing_to_move: %', p_date_a;
  end if;
  if v_session_b is null then
    raise exception 'nothing_to_move: %', p_date_b;
  end if;

  if exists (select 1 from public.workout_logs wl where wl.client_id = v_uid and wl.date = p_date_a) then
    raise exception 'already_logged: %', p_date_a;
  end if;
  if exists (select 1 from public.workout_logs wl where wl.client_id = v_uid and wl.date = p_date_b) then
    raise exception 'already_logged: %', p_date_b;
  end if;

  v_problem := public.move_target_problem(v_uid, p_date_a, p_date_b, array[p_date_b]);
  if v_problem is not null then
    raise exception '%: %', v_problem, p_date_b;
  end if;
  v_problem := public.move_target_problem(v_uid, p_date_b, p_date_a, array[p_date_a]);
  if v_problem is not null then
    raise exception '%: %', v_problem, p_date_a;
  end if;

  begin
    insert into public.change_requests
      (client_id, coach_id, from_date, to_date, session_id, session_name, batch_id, position, swap_id)
    select v_uid, v_profile.invited_by, p_date_a, p_date_b, v_session_a, s.name, p_batch_id, 1, v_swap_id
    from public.sessions s where s.id = v_session_a;

    insert into public.change_requests
      (client_id, coach_id, from_date, to_date, session_id, session_name, batch_id, position, swap_id)
    select v_uid, v_profile.invited_by, p_date_b, p_date_a, v_session_b, s.name, p_batch_id, 2, v_swap_id
    from public.sessions s where s.id = v_session_b;
  exception when unique_violation then
    -- C4: a day already waiting on a decision, said in domain terms.
    raise exception 'already_pending: %', p_date_a;
  end;

  if v_profile.move_approval = 'auto' then
    v_reason := public.apply_schedule_swap(
      (select id from public.change_requests where swap_id = v_swap_id and position = 1), v_uid, true);
  end if;

  -- N1: ids only, so the consumer renders the text at send time (N3).
  insert into public.notification_outbox (profile_id, kind, payload)
  values (
    v_profile.invited_by,
    'schedule_move_requested',
    jsonb_build_object('batch_id', p_batch_id, 'client_id', v_uid, 'auto_applied', v_profile.move_approval = 'auto')
  );

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'duplicate', false,
    'filed', 2,
    'auto_applied', v_profile.move_approval = 'auto',
    'applied', case when v_profile.move_approval = 'auto' and v_reason is null then 2 else 0 end,
    'skipped', case
      when v_reason is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'id', (select id from public.change_requests where swap_id = v_swap_id and position = 1),
        'reason', v_reason))
    end
  );
end;
$$;

comment on function public.request_schedule_swap(uuid, date, date) is
  'RPC (client): files a swap of two scheduled days as a linked pair of change_requests rows. Both days must be scheduled, unlogged, today or later and in the same assignment; each is re-validated server-side against live schedule and the client''s own today. Raises the move domain errors (nothing_to_move, already_logged, date_passed, program_changed, already_pending, invalid_moves) and lands nothing. Idempotent on p_batch_id. When profiles.move_approval = ''auto'' the swap is applied in the same transaction.';

revoke execute on function public.request_schedule_swap(uuid, date, date) from public, anon;
grant execute on function public.request_schedule_swap(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_schedule_moves: swap pairs are one decision
-- ---------------------------------------------------------------------------

create or replace function public.decide_schedule_moves(p_ids uuid[], p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_move public.change_requests%rowtype;
  v_reason text;
  v_applied int := 0;
  v_rejected int := 0;
  v_count int;
  v_skipped jsonb := '[]'::jsonb;
  v_clients uuid[] := '{}';
  v_done_swaps uuid[] := '{}';
  v_pair_id uuid;
begin
  if p_decision not in ('accept', 'reject') or p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'invalid_decision';
  end if;

  -- Applied in filing order, so a move that targets a day an earlier line
  -- vacates finds it free.
  for v_id in
    select cr.id from public.change_requests cr
    where cr.id = any (p_ids)
    order by cr.client_id, cr.batch_id, cr.position
  loop
    select * into v_move from public.change_requests where id = v_id for update;

    -- The other half of a swap was already decided with this one.
    if v_move.swap_id is not null and v_move.swap_id = any (v_done_swaps) then
      continue;
    end if;

    -- Re-check inside the transaction (C5): a line already decided, withdrawn
    -- or not addressed to this coach is reported, not applied twice.
    if v_move.status <> 'pending' or v_move.coach_id <> v_uid then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'not_found_or_forbidden');
      continue;
    end if;

    if v_move.swap_id is not null then
      -- A swap is one decision: ticking either half decides both.
      v_done_swaps := v_done_swaps || v_move.swap_id;

      if p_decision = 'reject' then
        update public.change_requests
        set status = 'rejected', responded_at = now(), decided_by = v_uid
        where swap_id = v_move.swap_id and status = 'pending';
        get diagnostics v_count = row_count;
        v_rejected := v_rejected + v_count;
      else
        v_reason := public.apply_schedule_swap(v_id, v_uid, false);
        if v_reason is null then
          v_applied := v_applied + 2;
        else
          for v_pair_id in select id from public.change_requests where swap_id = v_move.swap_id order by position loop
            v_skipped := v_skipped || jsonb_build_object('id', v_pair_id, 'reason', v_reason);
          end loop;
        end if;
      end if;
    elsif p_decision = 'reject' then
      update public.change_requests
      set status = 'rejected', responded_at = now(), decided_by = v_uid
      where id = v_id;
      v_rejected := v_rejected + 1;
    else
      v_reason := public.apply_schedule_move(v_id, v_uid, false);
      if v_reason is null then
        v_applied := v_applied + 1;
      else
        v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', v_reason);
      end if;
    end if;

    if not (v_move.client_id = any (v_clients)) then
      v_clients := v_clients || v_move.client_id;
    end if;
  end loop;

  insert into public.notification_outbox (profile_id, kind, payload)
  select c, 'schedule_move_decided', jsonb_build_object('client_id', c)
  from unnest(v_clients) as c;

  return jsonb_build_object('applied', v_applied, 'rejected', v_rejected, 'skipped', v_skipped);
end;
$$;

comment on function public.decide_schedule_moves(uuid[], text) is
  'RPC (coach): accept or reject any subset of pending moves addressed to the caller — one line or a whole batch. The two halves of a swap (shared swap_id) are always decided together, whichever half is passed. Each line is locked and re-checked inside the transaction, so a second call reports not_found_or_forbidden for it instead of double-applying. Accepting re-validates live; a move that can no longer apply is stamped skipped with its reason and reported back with the counts.';

-- ---------------------------------------------------------------------------
-- cancel_schedule_moves: withdrawing half a swap withdraws both
-- ---------------------------------------------------------------------------

create or replace function public.cancel_schedule_moves(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- Idempotent (C4): ids already decided, already withdrawn or not the
  -- caller's are simply not counted.
  update public.change_requests
  set status = 'cancelled', responded_at = now(), decided_by = auth.uid()
  where client_id = auth.uid() and status = 'pending'
    and (
      id = any (p_ids)
      or swap_id in (
        select cr.swap_id from public.change_requests cr
        where cr.id = any (p_ids) and cr.client_id = auth.uid() and cr.swap_id is not null
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.cancel_schedule_moves(uuid[]) is
  'RPC (client): withdraws the caller''s own pending moves; withdrawing either half of a swap withdraws both. Returns how many rows were withdrawn; moves already decided are left alone and not counted.';

-- ---------------------------------------------------------------------------
-- get_movable_days: pending moves carry swap_id so the screen can show a pair
-- as one line. Otherwise unchanged from 0041.
-- ---------------------------------------------------------------------------

create or replace function public.get_movable_days(p_lookback_days int default 28)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date;
  v_assignment_id uuid;
  v_start date;
  v_weeks int;
  v_end date;
  v_d date;
  v_session_id uuid;
  v_missed jsonb := '[]'::jsonb;
  v_upcoming jsonb := '[]'::jsonb;
  v_rest jsonb := '[]'::jsonb;
  v_pending_targets date[];
  v_pending_sources date[];
  v_has_log boolean;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'client') then
    raise exception 'forbidden';
  end if;

  -- C1: the client's today, computed the way every other SQL path does.
  v_today := public.client_today(v_uid);
  p_lookback_days := least(greatest(coalesce(p_lookback_days, 28), 1), 90);

  v_assignment_id := public.assignment_in_force(v_uid, v_today);
  if v_assignment_id is null then
    return jsonb_build_object('today', v_today, 'missed', v_missed, 'upcoming', v_upcoming, 'rest_days', v_rest, 'pending', '[]'::jsonb);
  end if;

  select a.start_date, p.weeks into v_start, v_weeks
  from public.assignments a join public.programs p on p.id = a.program_id
  where a.id = v_assignment_id;

  v_end := case when v_weeks is null then v_today + 120 else v_start + v_weeks * 7 - 1 end;

  select coalesce(array_agg(to_date), '{}'), coalesce(array_agg(from_date), '{}')
  into v_pending_targets, v_pending_sources
  from public.change_requests where client_id = v_uid and status = 'pending';

  -- generate_series has no date overload; walk timestamps and cast back.
  for v_d in
    select d::date
    from generate_series(
      greatest(v_start, v_today - p_lookback_days)::timestamp, v_end::timestamp, interval '1 day'
    ) as d
  loop
    -- Another assignment owns this day: it is not part of this program.
    if public.assignment_in_force(v_uid, v_d) is distinct from v_assignment_id then
      continue;
    end if;

    v_session_id := public.resolve_scheduled_workout(v_uid, v_d);
    v_has_log := exists (select 1 from public.workout_logs wl where wl.client_id = v_uid and wl.date = v_d);

    if v_session_id is not null then
      -- A day with any log is history, not movable.
      if not v_has_log and not (v_d = any (v_pending_sources)) then
        if v_d < v_today then
          v_missed := v_missed || jsonb_build_object(
            'date', v_d, 'session_id', v_session_id,
            'name', (select s.name from public.sessions s where s.id = v_session_id));
        else
          v_upcoming := v_upcoming || jsonb_build_object(
            'date', v_d, 'session_id', v_session_id,
            'name', (select s.name from public.sessions s where s.id = v_session_id));
        end if;
      end if;
    elsif v_d >= v_today and not v_has_log and not (v_d = any (v_pending_targets)) then
      v_rest := v_rest || to_jsonb(v_d);
    end if;
  end loop;

  return jsonb_build_object(
    'today', v_today,
    'missed', v_missed,
    'upcoming', v_upcoming,
    'rest_days', v_rest,
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cr.id, 'batch_id', cr.batch_id, 'from_date', cr.from_date,
        'to_date', cr.to_date, 'session_name', cr.session_name, 'swap_id', cr.swap_id)
        order by cr.batch_id, cr.position)
      from public.change_requests cr
      where cr.client_id = v_uid and cr.status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.get_movable_days(int) is
  'RPC (client): the reschedule and swap screens in one round trip. missed = scheduled days in the last p_lookback_days client-days with no log; upcoming = scheduled days still ahead (also what a swap can trade); rest_days = free days a workout could move to (rest, unlogged, today or later, not already targeted); pending = the caller''s pending moves, with swap_id set on both halves of a swap. Resolves through resolve_scheduled_workout and the client''s own today (R5, C1).';

-- ---------------------------------------------------------------------------
-- get_moved_days: carries swap_id so the grid can say "Swapped with Oct 28".
-- The return type is unchanged, so create or replace is enough.
-- ---------------------------------------------------------------------------

create or replace function public.get_moved_days(p_start_date date, p_days int default 7)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'from_date', cr.from_date, 'to_date', cr.to_date,
    'session_name', cr.session_name, 'auto_applied', cr.auto_applied,
    'swap_id', cr.swap_id
  ) order by cr.from_date), '[]'::jsonb)
  from public.change_requests cr
  where cr.client_id = auth.uid()
    and cr.status = 'accepted'
    and (cr.from_date between p_start_date and p_start_date + least(p_days, 31) - 1
         or cr.to_date between p_start_date and p_start_date + least(p_days, 31) - 1);
$$;

comment on function public.get_moved_days(date, int) is
  'RPC (client): accepted moves touching the window, with the snapshotted session name and swap_id (set when the move was half of a swap). A day that was moved away resolves to rest, so this is what lets the grid say "Moved to Oct 28" instead of an unexplained rest day.';
