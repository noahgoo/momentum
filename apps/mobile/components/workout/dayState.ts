/**
 * Pure day-state derivation for the workout week grid. Ported from the old
 * app's `getWeekDays` (mindful-miya/src/lib/services/assignments.ts) — same
 * state machine, no I/O.
 *
 * Mobile has no test runner configured yet (no vitest/jest config in
 * apps/mobile), so this pure function intentionally has no colocated test
 * file — see the slice report for the "would test if mobile had a runner"
 * note. Keep this function pure (no supabase/react-query imports) so it's
 * trivially testable the moment a runner is added.
 */

export type DayState =
  | "rest"
  | "done"
  | "inProgress"
  | "missed"
  | "today"
  | "future"
  | "outOfRange";

export interface DayStateInput {
  /** Whether anything is scheduled on this date (false = rest day). */
  hasWorkout: boolean;
  /** Whether this date falls within the assignment's active window at all. */
  inRange: boolean;
  /** workout_logs.completed for this date, if a log row exists. */
  completed: boolean;
  /**
   * Plan finding #5: "any set completed" — derived from exercise_logs/
   * set_logs, NOT from workout_logs.completed. True as soon as one set is
   * ticked, even before a full save.
   */
  hasProgress: boolean;
  /** YYYY-MM-DD for this cell. */
  dateStr: string;
  /** YYYY-MM-DD for "today" in the client's timezone. */
  todayStr: string;
}

/**
 * Derives the display state for one day cell in the week grid.
 *
 * Precedence (mirrors old app exactly):
 * 1. Out of the assignment's active window -> "outOfRange"
 * 2. No workout scheduled -> "rest"
 * 3. Logged complete -> "done"
 * 4. Any set completed but not marked complete -> "inProgress"
 * 5. Date is today -> "today"
 * 6. Date is in the future -> "future"
 * 7. Otherwise (past, scheduled, no progress) -> "missed"
 */
export function deriveDayState(input: DayStateInput): DayState {
  const { hasWorkout, inRange, completed, hasProgress, dateStr, todayStr } = input;

  if (!inRange) return "outOfRange";
  if (!hasWorkout) return "rest";
  if (completed) return "done";
  if (hasProgress) return "inProgress";
  if (dateStr === todayStr) return "today";
  if (dateStr > todayStr) return "future";
  return "missed";
}
