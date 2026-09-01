-- Wave 1.2: exercise library, workouts, programs, scheduling, assignments.

create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  default_sets int,
  default_reps int,
  default_duration_seconds int,
  default_miles numeric,
  default_mode exercise_mode,
  image_url text,
  video_url text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table exercises is 'Exercise library entries authored by a coach.';

create index exercises_created_by_idx on exercises (created_by);

create trigger set_updated_at
  before update on exercises
  for each row
  execute function set_updated_at();

create table workouts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  estimated_duration_minutes int,
  equipment text[],
  type workout_type not null default 'workout',
  warmup_id uuid references workouts (id),
  created_by uuid references profiles (id),
  client_id uuid references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table workouts is 'Workout or warmup definition. client_id set => per-client copy rather than a library template.';

create index workouts_warmup_id_idx on workouts (warmup_id);
create index workouts_created_by_idx on workouts (created_by);
create index workouts_client_id_idx on workouts (client_id);

create trigger set_updated_at
  before update on workouts
  for each row
  execute function set_updated_at();

create table workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts (id) on delete cascade,
  exercise_id uuid references exercises (id),
  sort_order int not null,
  mode exercise_mode not null default 'reps',
  set_configs jsonb not null default '[]'::jsonb,
  rest_seconds int,
  notes text,
  unique (workout_id, sort_order) deferrable initially deferred
);

comment on table workout_exercises is 'Exercise entries within a workout, in display order.';
comment on column workout_exercises.set_configs is
  'jsonb array of per-set config objects: {reps, weight, weight_unit, seconds, miles, pace_seconds}. Deviation from requirements'' jsonb[] — plain jsonb array is easier to validate/index and avoids Postgres array-of-jsonb quirks.';

create index workout_exercises_exercise_id_idx on workout_exercises (exercise_id);

create table programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  weeks int,
  created_by uuid references profiles (id),
  client_id uuid references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table programs is 'Multi-week program definition. client_id set => per-client copy rather than a library template.';

create index programs_created_by_idx on programs (created_by);
create index programs_client_id_idx on programs (client_id);

create trigger set_updated_at
  before update on programs
  for each row
  execute function set_updated_at();

create table program_phases (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs (id) on delete cascade,
  name text,
  sort_order int not null,
  weeks int,
  active_days day_of_week[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table program_phases is 'Ordered phases within a program; each phase spans some number of weeks and runs on active_days.';

create index program_phases_program_id_idx on program_phases (program_id);

create trigger set_updated_at
  before update on program_phases
  for each row
  execute function set_updated_at();

create table week_schedules (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references programs (id) on delete cascade,
  phase_id uuid references program_phases (id) on delete cascade,
  week_number int not null,
  day_of_week day_of_week not null,
  workout_id uuid references workouts (id),
  check ((program_id is null) <> (phase_id is null))
);

comment on table week_schedules is 'Maps (week_number, day_of_week) to a workout, scoped to exactly one of program_id or phase_id.';

create unique index week_schedules_program_week_day_key
  on week_schedules (program_id, week_number, day_of_week)
  where program_id is not null;

create unique index week_schedules_phase_week_day_key
  on week_schedules (phase_id, week_number, day_of_week)
  where phase_id is not null;

create index week_schedules_program_id_idx on week_schedules (program_id);
create index week_schedules_phase_id_idx on week_schedules (phase_id);
create index week_schedules_workout_id_idx on week_schedules (workout_id);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles (id) on delete cascade,
  program_id uuid not null references programs (id),
  start_date date not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table assignments is 'A client''s assignment of a program starting on start_date. Only one active assignment per client (plan constraint).';

create unique index assignments_one_active_per_client
  on assignments (client_id)
  where active;

create index assignments_client_id_idx on assignments (client_id);
create index assignments_program_id_idx on assignments (program_id);

create trigger set_updated_at
  before update on assignments
  for each row
  execute function set_updated_at();

create table assignment_date_overrides (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments (id) on delete cascade,
  date date not null,
  workout_id uuid references workouts (id),
  unique (assignment_id, date)
);

comment on table assignment_date_overrides is 'Per-client date overrides to the resolved schedule. workout_id NULL means an explicit rest day.';

create index assignment_date_overrides_workout_id_idx on assignment_date_overrides (workout_id);
