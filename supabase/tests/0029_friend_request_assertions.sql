-- Assertions for the friend-request insert policy (migration 0029).
--
-- The bug this guards against was total: `friendships_client_insert` checked
-- the same-coach rule by reading `profiles` as the CALLER, but profiles RLS
-- hides sibling rows from clients, so the EXISTS was always false and every
-- request was refused. Nothing surfaced it — the mutation had no onError, so
-- the UI showed a spinner and then nothing.
--
-- `force row level security` is load-bearing: without it the policy is skipped
-- for the table owner and every insert below would pass regardless.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0029_friend_request_assertions.sql

begin;

do $$
declare
  coach_a  uuid := 'aa000000-0000-0000-0000-000000000001';
  coach_b  uuid := 'aa000000-0000-0000-0000-000000000002';
  ava      uuid := 'aa000000-0000-0000-0000-00000000000a';
  sibling  uuid := 'aa000000-0000-0000-0000-00000000000b';
  other    uuid := 'aa000000-0000-0000-0000-00000000000c';
  stranger uuid := 'aa000000-0000-0000-0000-00000000000d';  -- coach_b's client
  failures text[] := '{}';
  v_pair text;
  v_status public.friendship_status;
  v_coach uuid;
  v_names jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (coach_a, 'fr-coach-a@test.local', jsonb_build_object('role','coach','display_name','Coach A')),
    (coach_b, 'fr-coach-b@test.local', jsonb_build_object('role','coach','display_name','Coach B')),
    (ava, 'fr-ava@test.local',
      jsonb_build_object('role','client','display_name','Ava','invited_by',coach_a::text)),
    (sibling, 'fr-sib@test.local',
      jsonb_build_object('role','client','display_name','Sibling','invited_by',coach_a::text)),
    (other, 'fr-other@test.local',
      jsonb_build_object('role','client','display_name','Other','invited_by',coach_a::text)),
    (stranger, 'fr-stranger@test.local',
      jsonb_build_object('role','client','display_name','Stranger','invited_by',coach_b::text))
  on conflict (id) do nothing;

  alter table public.friendships force row level security;
  perform set_config('request.jwt.claims', json_build_object('sub', ava)::text, true);
  perform set_config('role', 'authenticated', true);

  -- The reported bug: a client adding another client of the same coach.
  begin
    insert into public.friendships (client_id, friend_id, requested_by, status, pair_id, coach_id)
    values (ava, sibling, ava, 'pending', 'placeholder', ava);
  exception when others then
    failures := array_append(failures,
      format('sibling request refused: %s (%s)', sqlerrm, sqlstate));
  end;

  select pair_id, status, coach_id, member_names
    into v_pair, v_status, v_coach, v_names
  from public.friendships where client_id = ava and friend_id = sibling;

  if v_pair is null then
    failures := array_append(failures, 'no friendship row was written');
  else
    -- The trigger owns these three columns regardless of what the client sent.
    if v_pair = 'placeholder' then
      failures := array_append(failures, 'pair_id placeholder was not overwritten');
    end if;
    if v_coach is distinct from coach_a then
      failures := array_append(failures, format('coach_id resolved to %s', v_coach));
    end if;
    if v_names is null then
      failures := array_append(failures, 'member_names was not populated');
    end if;
    if v_status is distinct from 'pending' then
      failures := array_append(failures, format('status was %s, expected pending', v_status));
    end if;
  end if;

  -- The rules the policy exists to enforce must all still hold.
  begin
    insert into public.friendships (client_id, friend_id, requested_by, status, pair_id, coach_id)
    values (ava, stranger, ava, 'pending', 'placeholder', ava);
    failures := array_append(failures, 'SECURITY: cross-coach request accepted');
  exception when others then null;
  end;

  begin
    insert into public.friendships (client_id, friend_id, requested_by, status, pair_id, coach_id)
    values (other, sibling, other, 'pending', 'placeholder', other);
    failures := array_append(failures, 'SECURITY: request on another client''s behalf accepted');
  exception when others then null;
  end;

  begin
    insert into public.friendships (client_id, friend_id, requested_by, status, pair_id, coach_id)
    values (ava, other, ava, 'accepted', 'placeholder', ava);
    failures := array_append(failures, 'SECURITY: pre-accepted request accepted (self-accept)');
  exception when others then null;
  end;

  -- shares_my_coach itself, since the policy now leans on it entirely.
  if public.shares_my_coach(sibling) is not true then
    failures := array_append(failures, 'shares_my_coach said a true sibling does not share a coach');
  end if;
  if public.shares_my_coach(stranger) is not false then
    failures := array_append(failures, 'shares_my_coach said a different coach''s client is a sibling');
  end if;
  if public.shares_my_coach(coach_a) is not false then
    failures := array_append(failures, 'shares_my_coach treated the coach as a sibling');
  end if;

  raise exception 'FRIEND_REQUEST_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
