/**
 * Domain types layered on the generated `Database` type (db-types.ts).
 *
 * These are thin, ergonomic aliases — Row types for reads, Insert types for
 * writes — plus a handful of composite/jsonb shapes that the generated types
 * can't express (set_configs, friendship stats). Do not hand-edit db-types.ts;
 * extend it here instead.
 */

import type { Database, Json } from "./db-types.js";

type Tables = Database["public"]["Tables"];

// ---------------------------------------------------------------------------
// Enums (re-exported under friendlier names where useful)
// ---------------------------------------------------------------------------

export type ChangeRequestStatus = Database["public"]["Enums"]["change_request_status"];
export type DbDayOfWeek = Database["public"]["Enums"]["day_of_week"];
export type ExerciseMode = Database["public"]["Enums"]["exercise_mode"];
export type FriendshipStatus = Database["public"]["Enums"]["friendship_status"];
export type DbSex = Database["public"]["Enums"]["sex"];
export type UserRole = Database["public"]["Enums"]["user_role"];
export type WeightUnit = Database["public"]["Enums"]["weight_unit"];
export type WorkoutDifficulty = Database["public"]["Enums"]["workout_difficulty"];
export type WorkoutType = Database["public"]["Enums"]["workout_type"];

// ---------------------------------------------------------------------------
// Row / Insert aliases
// ---------------------------------------------------------------------------

export type Profile = Tables["profiles"]["Row"];
export type ProfileInsert = Tables["profiles"]["Insert"];

export type Exercise = Tables["exercises"]["Row"];
export type ExerciseInsert = Tables["exercises"]["Insert"];

export type Workout = Tables["workouts"]["Row"];
export type WorkoutInsert = Tables["workouts"]["Insert"];

export type WorkoutExercise = Tables["workout_exercises"]["Row"];
export type WorkoutExerciseInsert = Tables["workout_exercises"]["Insert"];

export type Program = Tables["programs"]["Row"];
export type ProgramInsert = Tables["programs"]["Insert"];

export type ProgramPhase = Tables["program_phases"]["Row"];
export type ProgramPhaseInsert = Tables["program_phases"]["Insert"];

export type WeekScheduleRow = Tables["week_schedules"]["Row"];
export type WeekScheduleRowInsert = Tables["week_schedules"]["Insert"];

export type Assignment = Tables["assignments"]["Row"];
export type AssignmentInsert = Tables["assignments"]["Insert"];

export type AssignmentDateOverride = Tables["assignment_date_overrides"]["Row"];
export type AssignmentDateOverrideInsert = Tables["assignment_date_overrides"]["Insert"];

export type WorkoutLog = Tables["workout_logs"]["Row"];
export type WorkoutLogInsert = Tables["workout_logs"]["Insert"];

export type ExerciseLog = Tables["exercise_logs"]["Row"];
export type ExerciseLogInsert = Tables["exercise_logs"]["Insert"];

export type SetLog = Tables["set_logs"]["Row"];
export type SetLogInsert = Tables["set_logs"]["Insert"];

export type Goal = Tables["goals"]["Row"];
export type GoalInsert = Tables["goals"]["Insert"];

export type GoalLog = Tables["goal_logs"]["Row"];
export type GoalLogInsert = Tables["goal_logs"]["Insert"];

export type Thread = Tables["threads"]["Row"];
export type ThreadInsert = Tables["threads"]["Insert"];

export type Message = Tables["messages"]["Row"];
export type MessageInsert = Tables["messages"]["Insert"];

export type Friendship = Tables["friendships"]["Row"];
export type FriendshipInsert = Tables["friendships"]["Insert"];

export type ChangeRequest = Tables["change_requests"]["Row"];
export type ChangeRequestInsert = Tables["change_requests"]["Insert"];

export type ProgressPhoto = Tables["progress_photos"]["Row"];
export type ProgressPhotoInsert = Tables["progress_photos"]["Insert"];

export type BodyMeasurement = Tables["body_measurements"]["Row"];
export type BodyMeasurementInsert = Tables["body_measurements"]["Insert"];

export type MotivationEntry = Tables["motivation_entries"]["Row"];
export type MotivationEntryInsert = Tables["motivation_entries"]["Insert"];

export type ClientSummary = Tables["client_summaries"]["Row"];
// client_summaries is trigger-written only (see plan finding #8) — no app-level
// Insert is exposed; apps never write this table directly.

// ---------------------------------------------------------------------------
// Composite type: SetConfig (workout_exercises.set_configs jsonb element)
// ---------------------------------------------------------------------------

/**
 * A single set's configuration, camelCase in TS. Mirrors the jsonb shape
 * documented on workout_exercises.set_configs:
 * {reps, weight, weight_unit, seconds, miles, pace_seconds, per_side,
 * weight_delta}.
 *
 * Adding a field here is a FIVE-part change — this interface, RawSetConfig,
 * parseSetConfig, serializeSetConfig, and setConfigSchema in schemas.ts. Miss
 * the serializer and the field silently never persists; miss the parser and it
 * silently never loads. `is_valid_set_config()` in SQL is the backstop: it
 * rejects any key it does not recognize, so a rename that misses a spot fails
 * loudly at write time instead of dropping data.
 */
export interface SetConfig {
  reps?: number;
  weight?: number;
  weightUnit?: WeightUnit;
  seconds?: number;
  miles?: number;
  paceSeconds?: number;
  /**
   * "Do this many reps on EACH side" (lunges, single-arm rows). Reps mode only
   * — dropped when a coach converts the exercise to time or distance.
   */
  perSide?: boolean;
  /**
   * Signed increment off the client's last logged weight for this exercise and
   * set number, e.g. 5 for "+5 lb from last". Its PRESENCE is what selects the
   * mode, and it TAKES PRECEDENCE over `weight` when both are set — a coach
   * toggling the increment off gets their fixed weight back untouched. Blank
   * (not zero, not the fixed weight) when the client has no prior. Resolved by
   * the mobile logger, never stored resolved on a template. Negative is legal:
   * a deload is a real prescription.
   */
  weightDelta?: number;
}

/** Raw (snake_case) jsonb shape as stored in Postgres. */
interface RawSetConfig {
  reps?: unknown;
  weight?: unknown;
  weight_unit?: unknown;
  seconds?: unknown;
  miles?: unknown;
  pace_seconds?: unknown;
  per_side?: unknown;
  weight_delta?: unknown;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isWeightUnit(v: unknown): v is WeightUnit {
  return v === "lbs" || v === "kg";
}

/**
 * Parses one raw jsonb set-config object (snake_case, as read from Postgres)
 * into the camelCase `SetConfig` shape. Unknown/malformed fields are dropped
 * rather than throwing — callers get back only the fields that validated.
 */
export function parseSetConfig(raw: unknown): SetConfig {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as RawSetConfig;
  const out: SetConfig = {};
  if (isFiniteNumber(r.reps)) out.reps = r.reps;
  if (isFiniteNumber(r.weight)) out.weight = r.weight;
  if (isWeightUnit(r.weight_unit)) out.weightUnit = r.weight_unit;
  if (isFiniteNumber(r.seconds)) out.seconds = r.seconds;
  if (isFiniteNumber(r.miles)) out.miles = r.miles;
  if (isFiniteNumber(r.pace_seconds)) out.paceSeconds = r.pace_seconds;
  if (typeof r.per_side === "boolean") out.perSide = r.per_side;
  // isFiniteNumber, not a truthiness check: a 0 delta ("hold last week's
  // weight") and a negative one (a deload) are both real prescriptions.
  if (isFiniteNumber(r.weight_delta)) out.weightDelta = r.weight_delta;
  return out;
}

/** Parses the full `set_configs` jsonb array (as stored) into `SetConfig[]`. */
export function parseSetConfigs(raw: Json): SetConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseSetConfig);
}

/** Serializes a `SetConfig` back to the snake_case jsonb shape for storage. */
export function serializeSetConfig(config: SetConfig): Json {
  const out: Record<string, Json> = {};
  if (config.reps !== undefined) out.reps = config.reps;
  if (config.weight !== undefined) out.weight = config.weight;
  if (config.weightUnit !== undefined) out.weight_unit = config.weightUnit;
  if (config.seconds !== undefined) out.seconds = config.seconds;
  if (config.miles !== undefined) out.miles = config.miles;
  if (config.paceSeconds !== undefined) out.pace_seconds = config.paceSeconds;
  if (config.perSide !== undefined) out.per_side = config.perSide;
  if (config.weightDelta !== undefined) out.weight_delta = config.weightDelta;
  return out;
}

/** Serializes a full `SetConfig[]` back to the jsonb array shape for storage. */
export function serializeSetConfigs(configs: SetConfig[]): Json {
  return configs.map(serializeSetConfig);
}

// ---------------------------------------------------------------------------
// Composite type: FriendshipMemberStats (friendships.stats jsonb, per member)
// ---------------------------------------------------------------------------

/**
 * Per-member stats snapshot stored (keyed by member user id) in
 * `friendships.stats`. Recomputed by `recompute_friendship_stats()` (plan
 * finding #4) on log completion + daily cron.
 */
export interface FriendshipMemberStats {
  streak: number;
  hasWorkoutToday: boolean;
  workoutDoneToday: boolean;
  /** YYYY-MM-DD date the stats were computed for (member's local "today"). */
  date: string;
}

/** `friendships.stats` jsonb shape: member user id -> that member's stats. */
export type FriendshipStats = Record<string, FriendshipMemberStats>;

function isFriendshipMemberStats(v: unknown): v is FriendshipMemberStats {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    isFiniteNumber(s.streak) &&
    typeof s.hasWorkoutToday === "boolean" &&
    typeof s.workoutDoneToday === "boolean" &&
    typeof s.date === "string"
  );
}

/** Parses the raw `friendships.stats` jsonb column into `FriendshipStats`. */
export function parseFriendshipStats(raw: Json): FriendshipStats {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: FriendshipStats = {};
  for (const [memberId, value] of Object.entries(raw)) {
    if (isFriendshipMemberStats(value)) out[memberId] = value;
  }
  return out;
}

/** Serializes `FriendshipStats` back to jsonb for storage. */
export function serializeFriendshipStats(stats: FriendshipStats): Json {
  const out: Record<string, Json> = {};
  for (const [memberId, s] of Object.entries(stats)) {
    out[memberId] = {
      streak: s.streak,
      hasWorkoutToday: s.hasWorkoutToday,
      workoutDoneToday: s.workoutDoneToday,
      date: s.date,
    };
  }
  return out;
}
