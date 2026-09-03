import { useQuery } from "@tanstack/react-query";
import { dateStr, parseDateStr, type Workout, type WorkoutLog } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { loadActiveAssignmentContext } from "./assignmentContext";
import { deriveDayState, type DayState } from "../../components/workout/dayState";

export interface WorkoutWeekDay {
  date: Date;
  dateStr: string;
  workout: Workout | null;
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
  /** Weekday index (0=Sun..6=Sat) the program's start date falls on — the
   * grid rotates so this weekday leads instead of always starting Monday. */
  startWeekday: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves one program week's 7-day grid, rotated so the program's start
 * weekday leads (constraint: "rotated so program's start weekday leads"),
 * rather than the old app's fixed Monday-Sunday calendar week.
 */
export function useWorkoutWeek(uid: string | undefined, weekNumber: number, todayStr: string) {
  return useQuery<WorkoutWeekResult | null>({
    queryKey: qk.workoutWeek(uid ?? "", weekNumber, todayStr),
    enabled: Boolean(uid) && weekNumber >= 1,
    queryFn: async () => {
      const clientId = uid as string;
      const ctx = await loadActiveAssignmentContext(clientId);
      if (!ctx) return null;

      const start = parseDateStr(ctx.startDateStr);
      if (!start) return null;

      const totalWeeks = ctx.program.weeks ?? 0;
      const daysDiffToday = Math.floor(
        (new Date(todayStr + "T00:00:00").getTime() - start.getTime()) / DAY_MS
      );
      const currentWeekNumber = Math.max(1, Math.floor(daysDiffToday / 7) + 1);
      const totalProgramDays = totalWeeks * 7;
      const percentElapsed =
        totalProgramDays > 0
          ? Math.min(100, Math.max(0, Math.round(((daysDiffToday + 1) / totalProgramDays) * 100)))
          : 0;

      const weekStart = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + (weekNumber - 1) * 7
      );

      const dayDates = Array.from(
        { length: 7 },
        (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)
      );
      const dayDateStrs = dayDates.map(dateStr);

      const resolvedWorkoutIds = dayDateStrs.map((d) => ctx.resolveDate(d));
      const workoutIds = [...new Set(resolvedWorkoutIds.filter((id): id is string => Boolean(id)))];

      const [{ data: workouts, error: workoutsError }, { data: logs, error: logsError }] =
        await Promise.all([
          workoutIds.length > 0
            ? supabase.from("workouts").select("*").in("id", workoutIds)
            : Promise.resolve({ data: [] as Workout[], error: null }),
          supabase
            .from("workout_logs")
            .select("*, exercise_logs(*, set_logs(*))")
            .eq("client_id", clientId)
            .gte("date", dayDateStrs[0])
            .lte("date", dayDateStrs[6]),
        ]);
      if (workoutsError) throw workoutsError;
      if (logsError) throw logsError;

      const workoutById = new Map((workouts ?? []).map((w) => [w.id, w]));
      const logByDate = new Map(
        (logs ?? []).map((log) => [
          log.date,
          log as WorkoutLog & { exercise_logs: Array<{ set_logs: Array<{ completed: boolean }> }> },
        ])
      );

      const days: WorkoutWeekDay[] = dayDates.map((date, i) => {
        const ds = dayDateStrs[i];
        const workoutId = resolvedWorkoutIds[i];
        const workout = workoutId ? (workoutById.get(workoutId) ?? null) : null;
        const log = logByDate.get(ds);
        const hasProgress =
          log?.exercise_logs?.some((ex) => ex.set_logs?.some((s) => s.completed)) ?? false;
        const inRange = ds >= ctx.startDateStr && ds <= ctx.endDateStr;

        return {
          date,
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
        programName: ctx.program.name,
        totalWeeks,
        currentWeekNumber,
        percentElapsed,
        days,
        startWeekday: start.getDay(),
      };
    },
  });
}
