-- Wave 1.3: workout logging, goals, threads/messages, friendships, change
-- requests, progress photos, body measurements, motivation entries.

create table workout_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles (id) on delete cascade,
  workout_id uuid references workouts (id),
  date date not null,
  completed boolean not null default false,
  difficulty workout_difficulty,
  next_day_feel int check (next_day_feel between 1 and 5),
  warmup_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date)
);

comment on table workout_logs is 'One row per (client, date) — the day''s workout completion record.';

create index workout_logs_client_id_idx on workout_logs (client_id);
create index workout_logs_workout_id_idx on workout_logs (workout_id);

create trigger set_updated_at
  before update on workout_logs
  for each row
  execute function set_updated_at();

create table exercise_logs (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references workout_logs (id) on delete cascade,
  exercise_id uuid references exercises (id),
  exercise_name text not null,
  mode exercise_mode not null default 'reps',
  sort_order int,
  created_at timestamptz not null default now()
);

comment on table exercise_logs is 'Per-exercise log row within a workout_log. exercise_name/mode are snapshots at log time.';

create index exercise_logs_workout_log_id_idx on exercise_logs (workout_log_id);
create index exercise_logs_exercise_id_idx on exercise_logs (exercise_id);

create table set_logs (
  id uuid primary key default gen_random_uuid(),
  exercise_log_id uuid not null references exercise_logs (id) on delete cascade,
  set_number int not null,
  reps int,
  weight numeric,
  weight_unit weight_unit,
  completed boolean not null default false,
  target_seconds int,
  actual_miles numeric,
  actual_seconds int
);

comment on table set_logs is 'Per-set completion detail within an exercise_log.';

create index set_logs_exercise_log_id_idx on set_logs (exercise_log_id);

create table goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles (id) on delete cascade,
  text text not null,
  set_by uuid references profiles (id),
  locked boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references profiles (id)
);

comment on table goals is 'Daily wellness/nutrition goal for a client. Soft-archived only (archived_at/archived_by), never hard-deleted.';

create index goals_client_id_idx on goals (client_id);
create index goals_set_by_idx on goals (set_by);
create index goals_archived_by_idx on goals (archived_by);

create table goal_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  date date not null,
  goal_text text,
  completed_at timestamptz not null default now(),
  unique (goal_id, date)
);

comment on table goal_logs is 'Daily completion record for a goal. goal_text is a snapshot; completed_at defaults to insert time.';

create index goal_logs_client_id_idx on goal_logs (client_id);

create table threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references profiles (id) on delete cascade,
  coach_id uuid not null references profiles (id),
  last_message text,
  last_message_at timestamptz,
  last_message_by uuid references profiles (id),
  unread_for_client boolean not null default false,
  unread_for_coach boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table threads is 'One messaging thread per client-coach pair, keyed by client_id.';

create index threads_coach_id_idx on threads (coach_id);
create index threads_last_message_by_idx on threads (last_message_by);

create trigger set_updated_at
  before update on threads
  for each row
  execute function set_updated_at();

create table messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  text text not null,
  sent_at timestamptz not null default now(),
  read boolean not null default false
);

comment on table messages is 'Individual chat message within a thread.';

create index messages_thread_id_sent_at_idx on messages (thread_id, sent_at);
create index messages_sender_id_idx on messages (sender_id);

create table friendships (
  pair_id text primary key,
  client_id uuid not null references profiles (id) on delete cascade,
  friend_id uuid not null references profiles (id) on delete cascade,
  coach_id uuid not null references profiles (id),
  requested_by uuid not null references profiles (id),
  status friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  member_names jsonb,
  shared_streak int not null default 0,
  stats jsonb,
  stats_updated_at timestamptz,
  check (client_id <> friend_id)
);

comment on table friendships is 'Client-to-client friendship, scoped to a shared coach. pair_id = sorted member UUIDs joined with ''_'' (set by a Wave 3 trigger).';

create index friendships_client_id_idx on friendships (client_id);
create index friendships_friend_id_idx on friendships (friend_id);
create index friendships_coach_id_idx on friendships (coach_id);
create index friendships_requested_by_idx on friendships (requested_by);

create table change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles (id) on delete cascade,
  coach_id uuid not null references profiles (id),
  from_date date not null,
  to_date date not null,
  workout_id uuid references workouts (id),
  status change_request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_date <> to_date)
);

comment on table change_requests is 'Client-initiated request to move a workout from from_date to to_date. Only one pending request per client.';

create unique index change_requests_one_pending_per_client
  on change_requests (client_id)
  where status = 'pending';

create index change_requests_coach_id_idx on change_requests (coach_id);
create index change_requests_workout_id_idx on change_requests (workout_id);

create table progress_photos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles (id) on delete cascade,
  storage_path text not null,
  url text,
  thumb_url text,
  width int,
  height int,
  size_bytes int,
  taken_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table progress_photos is 'Client progress photo metadata; the binary lives in Supabase Storage at storage_path.';

create index progress_photos_client_id_idx on progress_photos (client_id);

create table body_measurements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles (id) on delete cascade,
  date date not null,
  weight_lbs numeric,
  neck_in numeric,
  waist_in numeric,
  hips_in numeric,
  chest_in numeric,
  arm_in numeric,
  thigh_in numeric,
  created_at timestamptz not null default now(),
  unique (client_id, date)
);

comment on table body_measurements is 'Daily body measurement snapshot. Immutable in practice — clients delete and re-add rather than edit.';

create index body_measurements_client_id_idx on body_measurements (client_id);

create table motivation_entries (
  id uuid primary key default gen_random_uuid(),
  quote text not null,
  image_url text,
  week_start date,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

comment on table motivation_entries is 'Coach-authored "motivation of the week" entry.';

create index motivation_entries_created_by_idx on motivation_entries (created_by);
