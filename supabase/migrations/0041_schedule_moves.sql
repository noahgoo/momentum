-- Schedule moves: a client can ask to move many workouts at once, including
-- days they missed, and a coach can decide a whole batch or single lines.
--
-- Tier: every write here is Schedule tier — assignment_date_overrides rows for
-- one client on specific dates. No library row and no sessions row is touched,
-- and no Event row (workout_logs and below) is ever written or rewritten: a
-- move is refused when either date already has a log.
--
-- change_requests is evolved rather than replaced: one row is now ONE move,
-- and batch_id groups the moves a client filed together. The old shape (one
-- pending request per client, two-way swap, no cancel) is retired.

-- ---------------------------------------------------------------------------
-- change_requests: one row per move
-- ---------------------------------------------------------------------------

-- New enum values cannot be used until this transaction commits, so nothing
-- below references 'cancelled' or 'skipped' in a statement that runs now —
-- only inside function bodies, which are not evaluated until called.
alter type public.change_request_status add value if not exists 'cancelled';
alter type public.change_request_status add value if not exists 'skipped';

alter table public.change_requests
  add column batch_id uuid not null default gen_random_uuid(),
  add column position int not null default 0,
  add column session_name text,
  add column decided_by uuid references public.profiles (id) on delete set null,
  add column auto_applied boolean not null default false,
  add column skip_reason text;

comment on column public.change_requests.batch_id is
  'Groups the moves a client filed in one submission. Supplied by the client so a retried submission is recognised and does nothing twice (C4). Display and decision grouping only.';
comment on column public.change_requests.position is
  'Order of this move inside its batch. Moves are applied in this order, so a later move can target the day an earlier one frees.';
comment on column public.change_requests.session_name is
  'Snapshot of the session''s name when the move was filed (R8). History shows "Moved to <date>" with the name the client was actually given, and still can once the session is rebuilt or gone.';
comment on column public.change_requests.decided_by is
  'Who decided this move: the coach, or the client themselves when the coach set their approval to auto. NULL while pending (C8).';
comment on column public.change_requests.auto_applied is
  'True when profiles.move_approval = ''auto'' applied this move at filing time, so the UI can say "approved automatically" rather than imply a coach looked at it (C8).';
comment on column public.change_requests.skip_reason is
  'Why an accepted-or-auto move could not be applied: nothing_to_move, already_logged, date_passed, target_not_rest, program_changed. Set with status = skipped.';
comment on column public.change_requests.session_id is
  'What was scheduled when the move was FILED, for display only. apply_schedule_move re-resolves live and never trusts it (C5). `on delete set null`.';

update public.change_requests cr
set session_name = s.name
from public.sessions s
where s.id = cr.session_id and cr.session_name is null;

-- Many moves per client may now be pending; what must stay unique is a day
-- being asked about twice, as a source or as a target.
drop index public.change_requests_one_pending_per_client;

create unique index change_requests_one_pending_per_from_date
  on public.change_requests (client_id, from_date)
  where status = 'pending';

create unique index change_requests_one_pending_per_to_date
  on public.change_requests (client_id, to_date)
  where status = 'pending';

create index change_requests_batch_id_idx on public.change_requests (batch_id);

comment on table public.change_requests is
  'One client-requested move of a scheduled day from from_date to to_date. A client files many at once (batch_id groups them); the coach decides any subset, or the client''s moves apply immediately when profiles.move_approval = ''auto''. Written only by request_schedule_moves, decide_schedule_moves and cancel_schedule_moves — no insert/update/delete policies exist.';

-- The client could insert rows directly under this policy, skipping every
-- server-side check request_schedule_moves makes. All writes go through RPCs now.
drop policy change_requests_client_insert on public.change_requests;

alter publication supabase_realtime add table public.change_requests;

-- ---------------------------------------------------------------------------
-- profiles.move_approval: per-client coach setting
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column move_approval text not null default 'coach'
    check (move_approval in ('coach', 'auto'));

comment on column public.profiles.move_approval is
  '''coach'': a client''s moves wait for the coach. ''auto'': they apply at filing time and the coach is only told. Set by the coach through profiles_update_own_clients; a client cannot change their own (prevent_profile_privilege_change).';

create or replace function public.prevent_profile_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = new.id and (
    new.role is distinct from old.role
    or new.invited_by is distinct from old.invited_by
    or new.disabled is distinct from old.disabled
    or new.move_approval is distinct from old.move_approval
  ) then
    raise exception 'cannot change role, invited_by, disabled, or move_approval on your own profile';
  end if;
  return new;
end;
$$;

comment on function public.prevent_profile_privilege_change() is
  'Blocks a client from escalating privilege via their own self-update policy, including granting themselves auto-approved schedule moves. Only applies when the row being updated is the caller''s own (auth.uid() = new.id); coach-driven updates to a client row are unaffected.';

revoke execute on function public.prevent_profile_privilege_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C2: an override changes what a date resolves to, so it must refresh the
-- client's summary. assignment_date_overrides has no client_id, so the generic
-- trigger does not fit.
-- ---------------------------------------------------------------------------

create function public.trg_refresh_client_summary_on_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  select a.client_id into v_client_id
  from public.assignments a
  where a.id = case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;

  if v_client_id is not null then
    perform public.refresh_client_summary(v_client_id);
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.trg_refresh_client_summary_on_override() is
  'AFTER INSERT/UPDATE/DELETE on assignment_date_overrides: refreshes the owning client''s summary, since an override changes what today (and the streak) resolves to.';

revoke execute on function public.trg_refresh_client_summary_on_override() from public, anon, authenticated;

create trigger refresh_client_summary_on_overrides
  after insert or update or delete on public.assignment_date_overrides
  for each row
  execute function public.trg_refresh_client_summary_on_override();

-- ---------------------------------------------------------------------------
-- assignment_in_force: the assignment that governs a date. Same rule as
-- resolve_scheduled_workout, so a move and the resolver never disagree about
-- which assignment owns a day (R5). The old swap used the `active` assignment,
-- which differs after a reassign.
-- ---------------------------------------------------------------------------

create function public.assignment_in_force(p_client_id uuid, p_date date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.assignments a
  where a.client_id = p_client_id and a.start_date <= p_date
  order by a.start_date desc, a.created_at desc
  limit 1;
$$;

comment on function public.assignment_in_force(uuid, date) is
  'Id of the assignment governing p_date for a client: the latest one started by then, matching resolve_scheduled_workout. NULL before any assignment began.';

revoke execute on function public.assignment_in_force(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- move_target_problem: why a date cannot receive a moved workout, or NULL
-- when it can. Shared by filing and applying so they cannot drift apart.
-- ---------------------------------------------------------------------------

create function public.move_target_problem(
  p_client_id uuid,
  p_from_date date,
  p_to_date date,
  p_freed_dates date[] default '{}'
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_start date;
  v_weeks int;
begin
  -- C1: "today" is the client's, never the caller's clock.
  if p_to_date < public.client_today(p_client_id) then
    return 'date_passed';
  end if;

  v_assignment_id := public.assignment_in_force(p_client_id, p_to_date);
  if v_assignment_id is null
     or v_assignment_id is distinct from public.assignment_in_force(p_client_id, p_from_date) then
    return 'program_changed';
  end if;

  select a.start_date, p.weeks into v_start, v_weeks
  from public.assignments a
  join public.programs p on p.id = a.program_id
  where a.id = v_assignment_id;

  if p_to_date < v_start or (v_weeks is not null and p_to_date >= v_start + v_weeks * 7) then
    return 'program_changed';
  end if;

  if exists (
    select 1 from public.workout_logs wl
    where wl.client_id = p_client_id and wl.date = p_to_date
  ) then
    return 'already_logged';
  end if;

  -- A day another move in the same batch is vacating counts as rest.
  if public.resolve_scheduled_workout(p_client_id, p_to_date) is not null
     and not (p_to_date = any (p_freed_dates)) then
    return 'target_not_rest';
  end if;

  return null;
end;
$$;

comment on function public.move_target_problem(uuid, date, date, date[]) is
  'Why p_to_date cannot receive a moved workout (date_passed, program_changed, already_logged, target_not_rest), or NULL. Resolves through resolve_scheduled_workout, never the TS mirror (R5). p_freed_dates lets a batch target a day an earlier line is vacating.';

revoke execute on function public.move_target_problem(uuid, date, date, date[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- apply_schedule_move: internal. Moves one pending row's session to its
-- target and leaves the source day as rest. Returns NULL on success, or the
-- reason it could not apply (the row is then stamped skipped).
-- ---------------------------------------------------------------------------

create function public.apply_schedule_move(p_id uuid, p_decided_by uuid, p_auto boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move public.change_requests%rowtype;
  v_assignment_id uuid;
  v_session_id uuid;
  v_reason text;
begin
  select * into v_move from public.change_requests where id = p_id for update;

  if v_move.id is null or v_move.status <> 'pending' then
    raise exception 'not_found_or_forbidden';
  end if;

  v_assignment_id := public.assignment_in_force(v_move.client_id, v_move.from_date);
  -- Always re-resolve live — the session stored on the row is only what was
  -- scheduled when the move was filed (C5).
  v_session_id := public.resolve_scheduled_workout(v_move.client_id, v_move.from_date);

  if v_assignment_id is null or v_session_id is null then
    v_reason := 'nothing_to_move';
  elsif exists (
    select 1 from public.workout_logs wl
    where wl.client_id = v_move.client_id and wl.date = v_move.from_date
  ) then
    -- Event tier: a day the client already trained on is history.
    v_reason := 'already_logged';
  else
    v_reason := public.move_target_problem(v_move.client_id, v_move.from_date, v_move.to_date);
  end if;

  if v_reason is not null then
    update public.change_requests
    set status = 'skipped', skip_reason = v_reason, responded_at = now(),
        decided_by = p_decided_by, auto_applied = p_auto
    where id = p_id;
    return v_reason;
  end if;

  insert into public.assignment_date_overrides (assignment_id, date, session_id)
  values (v_assignment_id, v_move.to_date, v_session_id)
  on conflict (assignment_id, date) do update set session_id = excluded.session_id;

  -- The source becomes an explicit rest day. The accepted row, with its
  -- session_name snapshot, is the record that something was moved off it.
  insert into public.assignment_date_overrides (assignment_id, date, session_id)
  values (v_assignment_id, v_move.from_date, null)
  on conflict (assignment_id, date) do update set session_id = null;

  update public.change_requests
  set status = 'accepted', responded_at = now(), decided_by = p_decided_by,
      auto_applied = p_auto, skip_reason = null
  where id = p_id;

  return null;
end;
$$;

comment on function public.apply_schedule_move(uuid, uuid, boolean) is
  'Internal: applies one pending move. Re-resolves the source live, refuses logged days, and requires the target to be a rest day inside the same assignment (move_target_problem). Writes the target override and an explicit-rest override on the source. Returns NULL on success or the skip reason (row stamped skipped). Raises not_found_or_forbidden when the row is not pending. Not reachable by any client role.';

revoke execute on function public.apply_schedule_move(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- request_schedule_moves: client files many moves in one transaction
-- ---------------------------------------------------------------------------

create function public.request_schedule_moves(p_batch_id uuid, p_moves jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_line jsonb;
  v_pos int := 0;
  v_from date;
  v_to date;
  v_session_id uuid;
  v_problem text;
  v_freed date[] := '{}';
  v_targets date[] := '{}';
  v_ids uuid[] := '{}';
  v_id uuid;
  v_applied int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_reason text;
begin
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null or v_profile.role <> 'client' or v_profile.disabled or v_profile.invited_by is null then
    raise exception 'forbidden';
  end if;

  if p_batch_id is null or p_moves is null or jsonb_typeof(p_moves) <> 'array'
     or jsonb_array_length(p_moves) = 0 then
    raise exception 'invalid_moves';
  end if;
  if jsonb_array_length(p_moves) > 50 then
    raise exception 'too_many_moves';
  end if;

  -- C4: the same batch submitted twice (double tap, retry) does nothing the
  -- second time and reports what the first did.
  if exists (select 1 from public.change_requests where batch_id = p_batch_id) then
    if exists (
      select 1 from public.change_requests where batch_id = p_batch_id and client_id <> v_uid
    ) then
      raise exception 'forbidden';
    end if;
    return jsonb_build_object('batch_id', p_batch_id, 'duplicate', true);
  end if;

  for v_line in select * from jsonb_array_elements(p_moves) loop
    v_pos := v_pos + 1;
    begin
      v_from := (v_line->>'from_date')::date;
      v_to := (v_line->>'to_date')::date;
    exception when others then
      raise exception 'invalid_moves';
    end;
    if v_from is null or v_to is null or v_from = v_to then
      raise exception 'invalid_moves';
    end if;
    if v_from = any (v_freed) or v_to = any (v_targets) then
      raise exception 'duplicate_date: %', v_from;
    end if;

    v_session_id := public.resolve_scheduled_workout(v_uid, v_from);
    if v_session_id is null then
      raise exception 'nothing_to_move: %', v_from;
    end if;
    if exists (select 1 from public.workout_logs wl where wl.client_id = v_uid and wl.date = v_from) then
      raise exception 'already_logged: %', v_from;
    end if;

    v_problem := public.move_target_problem(v_uid, v_from, v_to, v_freed);
    if v_problem is not null then
      raise exception '%: %', v_problem, v_to;
    end if;

    begin
      insert into public.change_requests
        (client_id, coach_id, from_date, to_date, session_id, session_name, batch_id, position)
      select v_uid, v_profile.invited_by, v_from, v_to, v_session_id, s.name, p_batch_id, v_pos
      from public.sessions s where s.id = v_session_id
      returning id into v_id;
    exception when unique_violation then
      -- C4: a day that is already waiting on a decision, said in domain terms.
      raise exception 'already_pending: %', v_from;
    end;

    v_ids := v_ids || v_id;
    v_freed := v_freed || v_from;
    v_targets := v_targets || v_to;
  end loop;

  if v_profile.move_approval = 'auto' then
    foreach v_id in array v_ids loop
      v_reason := public.apply_schedule_move(v_id, v_uid, true);
      if v_reason is null then
        v_applied := v_applied + 1;
      else
        v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', v_reason);
      end if;
    end loop;
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
    'filed', array_length(v_ids, 1),
    'auto_applied', v_profile.move_approval = 'auto',
    'applied', v_applied,
    'skipped', v_skipped
  );
end;
$$;

comment on function public.request_schedule_moves(uuid, jsonb) is
  'RPC (client): files many moves in one transaction. p_moves is [{from_date, to_date}, ...] in the order they should apply. Each line is re-validated server-side against live schedule and the client''s own today; any invalid line raises a domain error (nothing_to_move, already_logged, date_passed, program_changed, target_not_rest, duplicate_date, already_pending, invalid_moves, too_many_moves) and nothing lands. Idempotent on p_batch_id. When profiles.move_approval = ''auto'' the moves are applied in the same transaction.';

revoke execute on function public.request_schedule_moves(uuid, jsonb) from public, anon;
grant execute on function public.request_schedule_moves(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_schedule_moves: coach accepts or rejects any subset
-- ---------------------------------------------------------------------------

create function public.decide_schedule_moves(p_ids uuid[], p_decision text)
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
  v_skipped jsonb := '[]'::jsonb;
  v_clients uuid[] := '{}';
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
    -- Re-check inside the transaction (C5): a line already decided, withdrawn
    -- or not addressed to this coach is reported, not applied twice.
    select * into v_move from public.change_requests where id = v_id for update;
    if v_move.status <> 'pending' or v_move.coach_id <> v_uid then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'not_found_or_forbidden');
      continue;
    end if;

    if p_decision = 'reject' then
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
  'RPC (coach): accept or reject any subset of pending moves addressed to the caller — one line or a whole batch. Each line is locked and re-checked inside the transaction, so a second call reports not_found_or_forbidden for it instead of double-applying. Accepting re-validates live; a move that can no longer apply is stamped skipped with its reason and reported back with the counts.';

revoke execute on function public.decide_schedule_moves(uuid[], text) from public, anon;
grant execute on function public.decide_schedule_moves(uuid[], text) to authenticated;

-- The old single-request RPCs stay for older builds, as thin wrappers.
create or replace function public.accept_change_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.decide_schedule_moves(array[p_request_id], 'accept');
  if jsonb_array_length(v_result->'skipped') > 0 then
    raise exception '%', (v_result->'skipped'->0->>'reason');
  end if;
end;
$$;

comment on function public.accept_change_request(uuid) is
  'Deprecated wrapper over decide_schedule_moves for builds that predate batches. Raises the skip reason (not_found_or_forbidden, nothing_to_move, ...) when the move did not apply.';

create or replace function public.reject_change_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.decide_schedule_moves(array[p_request_id], 'reject');
  if jsonb_array_length(v_result->'skipped') > 0 then
    raise exception '%', (v_result->'skipped'->0->>'reason');
  end if;
end;
$$;

comment on function public.reject_change_request(uuid) is
  'Deprecated wrapper over decide_schedule_moves for builds that predate batches.';

revoke execute on function public.accept_change_request(uuid) from public, anon;
grant execute on function public.accept_change_request(uuid) to authenticated;
revoke execute on function public.reject_change_request(uuid) from public, anon;
grant execute on function public.reject_change_request(uuid) to authenticated;

drop function public.apply_change_request_swap(uuid);

-- ---------------------------------------------------------------------------
-- cancel_schedule_moves: client withdraws their own pending moves
-- ---------------------------------------------------------------------------

create function public.cancel_schedule_moves(p_ids uuid[])
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
  where id = any (p_ids) and client_id = auth.uid() and status = 'pending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.cancel_schedule_moves(uuid[]) is
  'RPC (client): withdraws the caller''s own pending moves. Returns how many were withdrawn; moves already decided are left alone and not counted.';

revoke execute on function public.cancel_schedule_moves(uuid[]) from public, anon;
grant execute on function public.cancel_schedule_moves(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- get_movable_days: everything the reschedule screen needs, in one round trip
-- ---------------------------------------------------------------------------

create function public.get_movable_days(p_lookback_days int default 28)
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
        'to_date', cr.to_date, 'session_name', cr.session_name) order by cr.batch_id, cr.position)
      from public.change_requests cr
      where cr.client_id = v_uid and cr.status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.get_movable_days(int) is
  'RPC (client): the reschedule screen in one round trip. missed = scheduled days in the last p_lookback_days client-days with no log; upcoming = scheduled days still ahead; rest_days = free days a workout could move to (rest, unlogged, today or later, not already targeted); pending = the caller''s pending moves. Resolves through resolve_scheduled_workout and the client''s own today (R5, C1).';

revoke execute on function public.get_movable_days(int) from public, anon;
grant execute on function public.get_movable_days(int) to authenticated;

-- ---------------------------------------------------------------------------
-- get_moved_days: where a day's workout went, for the week grid
-- ---------------------------------------------------------------------------

create function public.get_moved_days(p_start_date date, p_days int default 7)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'from_date', cr.from_date, 'to_date', cr.to_date,
    'session_name', cr.session_name, 'auto_applied', cr.auto_applied
  ) order by cr.from_date), '[]'::jsonb)
  from public.change_requests cr
  where cr.client_id = auth.uid()
    and cr.status = 'accepted'
    and (cr.from_date between p_start_date and p_start_date + least(p_days, 31) - 1
         or cr.to_date between p_start_date and p_start_date + least(p_days, 31) - 1);
$$;

comment on function public.get_moved_days(date, int) is
  'RPC (client): accepted moves touching the window, with the snapshotted session name. A day that was moved away resolves to rest, so this is what lets the grid say "Moved to Oct 28" instead of an unexplained rest day.';

revoke execute on function public.get_moved_days(date, int) from public, anon;
grant execute on function public.get_moved_days(date, int) to authenticated;
