/** Minimal hand-written types for the shared package's pure-logic modules. */

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type Sex = "male" | "female";

/** A single week's day -> workoutId map. Empty string ("") or absent means rest. */
export type DaySchedule = Partial<Record<DayOfWeek, string>>;

/** Maps week number (as a string key, "1", "2", ...) to that week's day schedule. */
export type WeekSchedule = Record<string, DaySchedule>;

/** A single phase within a phased program (client-side preview shape). */
export interface PhasePreview {
  id: string;
  weeks: number;
  weekSchedule: WeekSchedule;
}

/**
 * Client-side preview shape of a program, sufficient to resolve a scheduled
 * workout for a given date. The authoritative resolution logic lives in SQL
 * (resolve_scheduled_workout) — this is a preview-only mirror.
 */
export interface ProgramPreview {
  id: string;
  weeks: number;
  weekSchedule: WeekSchedule;
  /** When present and non-empty, phases are flattened into global week keys. */
  phases?: PhasePreview[];
}

/** Inputs needed to resolve a scheduled workout for a date. */
export interface AssignmentPreview {
  startDate: string; // YYYY-MM-DD
  program: ProgramPreview;
  /** Per-date overrides: workoutId string, or null for an explicit rest day. */
  overrides?: Record<string, string | null>;
}

/** Body-fat calculation inputs: profile-level measurements. */
export interface BodyFatProfile {
  sex?: Sex;
  heightIn?: number;
}

/** Body-fat calculation inputs: a single measurement entry. */
export interface BodyFatEntry {
  neckIn?: number;
  waistIn?: number;
  hipsIn?: number;
}
