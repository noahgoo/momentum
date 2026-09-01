-- Wave 1.4: denormalized client_summaries table for the coach dashboard grid.
-- Populated exclusively by Wave 3 triggers/functions — no application writes.

create table client_summaries (
  client_id uuid primary key references profiles (id) on delete cascade,
  coach_id uuid not null,
  display_name text,
  email text,
  disabled boolean not null default false,
  has_program boolean not null default false,
  today_workout_name text,
  workout_done boolean not null default false,
  active_goal_count int not null default 0,
  goals_completed_today int not null default 0,
  streak int not null default 0,
  unread_for_coach boolean not null default false,
  last_message_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table client_summaries is 'Denormalized per-client rollup for the coach dashboard grid. Written only by triggers/functions (Wave 3) — never written directly by the app.';

create index client_summaries_coach_id_idx on client_summaries (coach_id);

create trigger set_updated_at
  before update on client_summaries
  for each row
  execute function set_updated_at();
