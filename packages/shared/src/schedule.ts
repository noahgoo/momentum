import type {
  AssignmentPreview,
  DayOfWeek,
  ProgramPreview,
  WeekSchedule,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const DAY_NAMES: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Parses a YYYY-MM-DD string as a local calendar date (no timezone shift). */
export function parseDateStr(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** Formats a Date as a YYYY-MM-DD string using its local (already-resolved) calendar fields. */
export function dateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Flatten phased week schedules into global week keys ("1", "2", …).
 * Builder preview only — see getWorkoutIdForDate.
 */
export function resolveWeekSchedule(program: ProgramPreview): WeekSchedule {
  if (!program.phases || program.phases.length === 0) return program.weekSchedule;
  const global: WeekSchedule = {};
  let offset = 0;
  for (const phase of program.phases) {
    for (let w = 1; w <= phase.weeks; w++) {
      global[String(offset + w)] = phase.weekSchedule[String(w)] ?? {};
    }
    offset += phase.weeks;
  }
  return global;
}

/**
 * Resolves the workoutId scheduled for `targetDateStr`.
 *
 * BUILDER PREVIEW ONLY. The authoritative implementation is SQL's
 * `resolve_scheduled_workout`, reachable from the client through the
 * `get_workout_day` / `get_workout_week` RPCs — use those for anything a
 * client actually sees. This exists solely so the coach's builder can preview
 * a program that has not been saved yet, where there is no server state to
 * query.
 *
 * Never resolve live client data with this: two implementations of the same
 * rules drift, which is exactly what violation B9 was.
 *
 * Returns null if the date is before start, past the program length, or a rest
 * day. An override entry of null means explicit rest; a non-empty string wins
 * outright.
 */
export function getWorkoutIdForDate(
  assignment: AssignmentPreview,
  targetDateStr: string
): string | null {
  const { startDate, program, overrides } = assignment;

  if (overrides && Object.prototype.hasOwnProperty.call(overrides, targetDateStr)) {
    return overrides[targetDateStr] ?? null;
  }

  const target = parseDateStr(targetDateStr);
  const start = parseDateStr(startDate);
  if (!target || !start) return null;

  const daysDiff = Math.floor((target.getTime() - start.getTime()) / DAY_MS);
  if (daysDiff < 0) return null;

  const weekNumber = Math.floor(daysDiff / 7) + 1;
  if (weekNumber > program.weeks) return null;

  const dayName = DAY_NAMES[target.getDay()] as DayOfWeek;
  const schedule = resolveWeekSchedule(program);
  return schedule[String(weekNumber)]?.[dayName] || null;
}
