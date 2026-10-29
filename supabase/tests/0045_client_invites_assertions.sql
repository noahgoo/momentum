-- Assertions for 0045: invite state, and disabled writable only without a
-- signed-in caller (the manage-client Edge Function runs as service role).
--
-- Same rollback-safe shape as the other suites.
--
-- Run with: psql "$DATABASE_URL" -f supabase/tests/0045_client_invites_assertions.sql

begin;

do $$
declare
  failures text[] := '{}';

  coach_id uuid := 'e1000000-0000-0000-0000-000000000001';
  client_a uuid := 'e1000000-0000-0000-0000-00000000000a';
  client_b uuid := 'e1000000-0000-0000-0000-00000000000b';
  v_invited timestamptz := now() - interval '1 day';
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (coach_id, 'inv-coach@test.local', jsonb_build_object('role','coach','display_name','Inv Coach')),
    (client_a, 'inv-a@test.local',
      jsonb_build_object('role','client','display_name','Inv A','invited_by',coach_id::text));

  insert into auth.users (id, email, invited_at, raw_user_meta_data)
  values (client_b, 'inv-b@test.local', v_invited,
      jsonb_build_object('role','client','display_name','Inv B','invited_by',coach_id::text));

  -- 1. invited_at follows auth.users.invited_at; password-created accounts have none.
  if (select invited_at from public.profiles where id = client_a) is not null then
    failures := array_append(failures, 'password-created client has invited_at');
  end if;
  if (select invited_at from public.profiles where id = client_b) is distinct from v_invited then
    failures := array_append(failures, 'invited client did not copy invited_at');
  end if;

  -- 2. Confirming the email stamps invite_accepted_at, for invited users only.
  update auth.users set email_confirmed_at = now() where id in (client_a, client_b);
  if (select invite_accepted_at from public.profiles where id = client_b) is null then
    failures := array_append(failures, 'confirming an invite did not stamp invite_accepted_at');
  end if;
  if (select invite_accepted_at from public.profiles where id = client_a) is not null then
    failures := array_append(failures, 'a non-invited account got invite_accepted_at');
  end if;

  -- 3. The service role / no-caller path can set disabled.
  update public.profiles set disabled = true where id = client_a;
  if not (select disabled from public.profiles where id = client_a) then
    failures := array_append(failures, 'disabled could not be set without a signed-in caller');
  end if;

  -- 4. The coach cannot flip disabled directly.
  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);
  begin
    update public.profiles set disabled = false where id = client_a;
    failures := array_append(failures, 'coach changed disabled directly');
  exception when raise_exception then
    null;
  end;

  -- 5. The client cannot flip it, or their invite state, on themself.
  perform set_config('request.jwt.claims', json_build_object('sub', client_b)::text, true);
  begin
    update public.profiles set disabled = true where id = client_b;
    failures := array_append(failures, 'client changed their own disabled');
  exception when raise_exception then
    null;
  end;
  begin
    update public.profiles set invite_accepted_at = null where id = client_b;
    failures := array_append(failures, 'client cleared their own invite state');
  exception when raise_exception then
    null;
  end;

  -- 6. The coach can still edit other columns of their client.
  perform set_config('request.jwt.claims', json_build_object('sub', coach_id)::text, true);
  update public.profiles set display_name = 'Renamed' where id = client_b;

  raise exception 'CLIENT_INVITES_ASSERTIONS % — %',
    (case when failures = '{}' then 'PASSED' else 'FAILED' end),
    failures;
end;
$$;

rollback;
