import { useQuery } from "@tanstack/react-query";
import { addDaysStr, dateStr, parseDateStr, type WorkoutLog } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { deriveDayState, type DayState } from "../../components/workout/dayState";

/** One row of get_workout_week's payload. */
interface WeekRow {
  date: string;
  workout_id: string | null;
  name: string | null;
  estimated_duration_minutes: number | null;
  completed: boolean;
}

/** Just enough of a session for the week grid to render a day. */
export interface WeekWorkout {
  id: string;
  name: string | null;
  estimated_duration_minutes: number | null;
}

export interface WorkoutWeekDay {
  /**
   * No Date object here. This result is persisted to AsyncStorage, and a Date
   * survives JSON.stringify only as a string — so after a restart any method
   * call on it threw. `dateStr` is the stored form; render from that.
   */
  dateStr: string;
  workout: WeekWorkout | null;
  state: DayState;
}

export interface WorkoutWeekResult {
  programName: string;
  /** Program's total length in weeks (for "Week X of Y"). */
  totalWeeks: number;
  /** 1-based program week currently containing "today" (used to clamp/seed the pill selector). */
  currentWeekNumber: number;
  /** % of program days elapsed as of today, clamped to [0, 100]. */
  percentElapsed: number;
  days: WorkoutWeekDay[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves one program week's 7-day grid, Monday-to-Sunday. A program always
 * starts on a Monday (0043), so week n is exactly start_date + 7(n-1) .. +6.
 * Programs backfilled from a midweek start show their first days as rest.
 */
export function useWorkoutWeek(uid: string | undefined, weekNumber: number, todayStr: string) {
  return useQuery<WorkoutWeekResult | null>({
    queryKey: qk.workoutWeek(uid ?? "", weekNumber, todayStr),
    enabled: Boolean(uid) && weekNumber >= 1,
    queryFn: async () => {
      const clientId = uid as string;

      // Only the program's window and name are needed here — resolution
      // itself happens in SQL (get_workout_week), not from a client-side
      // mirror of the schedule rules.
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("start_date, programs(name, weeks)")
        .eq("client_id", clientId)
        .eq("active", true)
        .maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment?.programs) return null;

      const program = assignment.programs as unknown as { name: string; weeks: number | null };
      const startDateStr = assignment.start_date;
      const start = parseDateStr(startDateStr);
      if (!start) return null;

      const programTotalWeeks = program.weeks ?? 0;
      const endDateStr =
        programTotalWeeks > 0
          ? dateStr(
              new Date(
                start.getFullYear(),
                start.getMonth(),
                start.getDate() + programTotalWeeks * 7 - 1
              )
            )
          : startDateStr;

      const daysDiffToday = Math.floor(
        (new Date(todayStr + "T00:00:00").getTime() - start.getTime()) / DAY_MS
      );
      const totalProgramDays = programTotalWeeks * 7;
      const percentElapsed =
        totalProgramDays > 0
          ? Math.min(100, Math.max(0, Math.round(((daysDiffToday + 1) / totalProgramDays) * 100)))
          : 0;

      // start_date is always a Monday (0043), so program weeks are calendar
      // weeks and week n starts at start_date + 7(n-1).
      const totalWeeks = Math.max(1, programTotalWeeks);
      const currentWeekNumber = Math.max(1, Math.floor(daysDiffToday / 7) + 1);

      const weekStart = addDaysStr(startDateStr, (weekNumber - 1) * 7);
      const dayDateStrs = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));

      // One call resolves all seven days through the same SQL the day view
      // uses, so the grid can never disagree with what the day screen shows.
      const { data: weekRows, error: weekError } = await supabase.rpc("get_workout_week", {
        p_start_date: dayDateStrs[0],
        p_days: 7,
      });
      if (weekError) throw new Error(weekError.message);

      // The RPC carries the display fields, so there is no second query for
      // them. There cannot be: a client has no policy letting them read the
      // coach's `workouts` library, and that read would have failed silently
      // by returning an empty set rather than erroring.
      const rowByDate = new Map(((weekRows ?? []) as unknown as WeekRow[]).map((row) => [row.date, row]));

      const { data: logs, error: logsError } = await supabase
        .from("workout_logs")
        .select("*, exercise_logs(*, set_logs(*))")
        .eq("client_id", clientId)
        .gte("date", dayDateStrs[0])
        .lte("date", dayDateStrs[6]);
      if (logsError) throw logsError;
      const logByDate = new Map(
        (logs ?? []).map((log) => [
          log.date,
          log as WorkoutLog & { exercise_logs: Array<{ set_logs: Array<{ completed: boolean }> }> },
        ])
      );

      const days: WorkoutWeekDay[] = dayDateStrs.map((ds) => {
        const row = rowByDate.get(ds);
        const workout: WeekWorkout | null = row?.workout_id
          ? {
              id: row.workout_id,
              name: row.name,
              estimated_duration_minutes: row.estimated_duration_minutes,
            }
          : null;
        const log = logByDate.get(ds);
        const hasProgress =
          log?.exercise_logs?.some((ex) => ex.set_logs?.some((s) => s.completed)) ?? false;
        const inRange = ds >= startDateStr && ds <= endDateStr;

        return {
          dateStr: ds,
          workout,
          state: deriveDayState({
            hasWorkout: Boolean(workout),
            inRange,
            completed: log?.completed ?? false,
            hasProgress,
            dateStr: ds,
            todayStr,
          }),
        };
      });

      return {
        programName: program.name,
        totalWeeks,
        currentWeekNumber,
        percentElapsed,
        days,
      };
    },
  });
}
