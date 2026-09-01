-- Wave 3 fix: null-safe ownership checks in accept_change_request /
-- reject_change_request (0013, already applied remotely).
--
-- Bug: `v_request.coach_id <> auth.uid()` fails open when auth.uid() is
-- NULL — comparing anything to NULL with <> yields NULL (not TRUE), so the
-- `or` chain could evaluate to NULL/false and skip the raise even though
-- there is no authenticated caller to own the request against. Surfaced by
-- the assertion suite's expected-raise test for not_found_or_forbidden,
-- which did not raise.
--
-- Fix: use IS DISTINCT FROM, which treats NULL comparisons as definite
-- inequality (auth.uid() IS NULL is always "distinct from" any real
-- coach_id), so the check is null-safe in both directions. Recreated via
-- CREATE OR REPLACE — everything else (signature, locking, swap delegation,
-- grants) is identical to 0013.

create or replace function public.accept_change_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.change_requests%rowtype;
begin
  select * into v_request
  from public.change_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.status <> 'pending' or v_request.coach_id is distinct from auth.uid() then
    raise exception 'not_found_or_forbidden';
  end if;

  perform public.apply_change_request_swap(p_request_id);
end;
$$;

comment on function public.accept_change_request(uuid) is
  'RPC: coach accepts a pending change request. Locks the row (FOR UPDATE), requires status=pending and coach_id=auth.uid() (raises not_found_or_forbidden otherwise, including when auth.uid() is null), then delegates the swap to apply_change_request_swap.';

create or replace function public.reject_change_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.change_requests%rowtype;
begin
  select * into v_request
  from public.change_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.status <> 'pending' or v_request.coach_id is distinct from auth.uid() then
    raise exception 'not_found_or_forbidden';
  end if;

  update public.change_requests
  set status = 'rejected', responded_at = now()
  where id = p_request_id;
end;
$$;

comment on function public.reject_change_request(uuid) is
  'RPC: coach rejects a pending change request. Same null-safe lock/ownership/pending checks as accept_change_request.';

-- Grants/revokes are unchanged from 0013 (CREATE OR REPLACE preserves
-- existing grants), but restated here for clarity/idempotency.
revoke execute on function public.accept_change_request(uuid) from public, anon;
grant execute on function public.accept_change_request(uuid) to authenticated;
revoke execute on function public.reject_change_request(uuid) from public, anon;
grant execute on function public.reject_change_request(uuid) to authenticated;
