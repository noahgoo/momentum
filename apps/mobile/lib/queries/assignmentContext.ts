import {
  getWorkoutIdForDate,
  dateStr,
  parseDateStr,
  type DayOfWeek,
  type Program,
  type ProgramPhase,
  type Assignment,
  type WeekSchedule,
} from "@momentum/shared";
import { supabase } from "../supabase";

/**
 * Shared "resolve the active assignment + program schedule" fetch, factored
 * out of useTodayWorkout's inline logic so the workout-tab week/day hooks
 * (which need to resolve *arbitrary* dates, not just today) don't duplicate
 * it. Mirrors useTodayWorkout's steps (b)-(d) exactly — same source of truth
 * (SQL's resolve_scheduled_workout), same client-side preview approach via
 * getWorkoutIdForDate.
 */
export interface AssignmentContext {
  assignment: Assignment;
  program: Program;
  /** Program's active window, inclusive, as YYYY-MM-DD strings. */
  startDateStr: string;
  endDateStr: string;
  /** Resolves a date -> scheduled workoutId (or null for rest/out-of-range). */
  resolveDate: (targetDateStr: string) => string | null;
}

export async function loadActiveAssignmentContext(
  clientId: string
): Promise<AssignmentContext | null> {
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("*, programs(*)")
    .eq("client_id", clientId)
    .eq("active", true)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment || !assignment.programs) return null;

  const program = assignment.programs as Program;

  const [{ data: phases, error: phasesError }, { data: scheduleRows, error: scheduleError }] =
    await Promise.all([
      supabase
        .from("program_phases")
        .select("*")
        .eq("program_id", program.id)
        .order("sort_order", { ascending: true }),
      supabase.from("week_schedules").select("*").eq("program_id", program.id),
    ]);
  if (phasesError) throw phasesError;
  if (scheduleError) throw scheduleError;

  let phaseScheduleRows = scheduleRows ?? [];
  if (phases && phases.length > 0) {
    const { data: phaseRows, error: phaseRowsError } = await supabase
      .from("week_schedules")
      .select("*")
      .in(
        "phase_id",
        phases.map((p) => p.id)
      );
    if (phaseRowsError) throw phaseRowsError;
    phaseScheduleRows = [...phaseScheduleRows, ...(phaseRows ?? [])];
  }

  const { data: overrideRows, error: overrideError } = await supabase
    .from("assignment_date_overrides")
    .select("*")
    .eq("assignment_id", assignment.id);
  if (overrideError) throw overrideError;

  const overrides: Record<string, string | null> = {};
  for (const row of overrideRows ?? []) {
    overrides[row.date] = row.workout_id;
  }

  const previewProgram = {
    id: program.id,
    weeks: program.weeks ?? 0,
    weekSchedule: buildWeekSchedule(phaseScheduleRows.filter((r) => !r.phase_id)),
    phases: (phases ?? []).map((phase: ProgramPhase) => ({
      id: phase.id,
      weeks: phase.weeks ?? 0,
      weekSchedule: buildWeekSchedule(phaseScheduleRows.filter((r) => r.phase_id === phase.id)),
    })),
  };

  const start = parseDateStr(assignment.start_date);
  const totalWeeks = program.weeks ?? 0;
  const endDateStr =
    start && totalWeeks > 0
      ? dateStr(new Date(start.getFullYear(), start.getMonth(), start.getDate() + totalWeeks * 7 - 1))
      : assignment.start_date;

  return {
    assignment,
    program,
    startDateStr: assignment.start_date,
    endDateStr,
    resolveDate: (targetDateStr: string) =>
      getWorkoutIdForDate(
        { startDate: assignment.start_date, program: previewProgram, overrides },
        targetDateStr
      ),
  };
}

/**
 * week_schedules rows are one-row-per-(week,day). Mirrors the identical
 * helper in useTodayWorkout.ts.
 */
function buildWeekSchedule(
  rows: Array<{ week_number: number; day_of_week: DayOfWeek; workout_id: string | null }>
): WeekSchedule {
  const schedule: WeekSchedule = {};
  for (const row of rows) {
    const weekKey = String(row.week_number);
    if (!schedule[weekKey]) schedule[weekKey] = {};
    if (row.workout_id) {
      schedule[weekKey][row.day_of_week] = row.workout_id;
    }
  }
  return schedule;
}
