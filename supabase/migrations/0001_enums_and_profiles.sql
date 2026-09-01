-- Wave 1.1: enums, pgcrypto, profiles, shared updated_at trigger function.

create extension if not exists pgcrypto;

create type user_role as enum ('coach', 'client');
create type exercise_mode as enum ('reps', 'time', 'distance');
create type workout_type as enum ('workout', 'warmup');
create type day_of_week as enum ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');
create type workout_difficulty as enum ('too_easy', 'challenging', 'overly_challenging');
create type weight_unit as enum ('lbs', 'kg');
create type friendship_status as enum ('pending', 'accepted');
create type change_request_status as enum ('pending', 'accepted', 'rejected');
create type sex as enum ('male', 'female');

-- Shared trigger function: keeps updated_at current on every UPDATE.
-- Attached to every table below that carries an updated_at column.
create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function set_updated_at() is 'BEFORE UPDATE trigger: stamps NEW.updated_at = now(). Attach to every table with an updated_at column.';

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  role user_role not null,
  invited_by uuid references profiles (id),
  notification_time time,
  timezone text,
  height_in numeric,
  sex sex,
  notifications_enabled boolean not null default true,
  disabled boolean not null default false,
  last_reminder_date date,
  fcm_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table profiles is 'One row per auth.users identity; role distinguishes coach vs client. invited_by = client''s coach.';

create index profiles_invited_by_idx on profiles (invited_by);

create trigger set_updated_at
  before update on profiles
  for each row
  execute function set_updated_at();
