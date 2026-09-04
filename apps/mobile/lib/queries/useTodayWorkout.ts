import { useQuery } from "@tanstack/react-query";
import type { Workout, WorkoutExercise, WorkoutLog } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface TodayWorkoutResult {
  /** null when today is a rest day, no active assignment exists, or nothing is scheduled. */
  workout: Workout | null;
  exercises: WorkoutExercise[];
  /** Today's workout_log row, if one exists yet (created on first set/warmup tick). */
  log: WorkoutLog | null;
  streak: number;
}

/**
 * Today's workout, its exercises, today's log, and the streak.
 *
 * Both halves come from SQL: `get_workout_day` resolves the schedule (this
 * hook used to carry its own ~90-line copy of the resolution rules, a third
 * implementation alongside the shared mirror and assignmentContext — see
 * violation B9), and `get_my_streak` owns the streak, as it always has.
 *
 * `today` is passed in from useClientDate rather than read off the device
 * clock, and is part of the query key so a date rollover is a new query
 * rather than a stale one (C1).
 */
export function useTodayWorkout(uid: string | undefined, today: string) {
  return useQuery<TodayWorkoutResult>({
    queryKey: qk.todayWorkout(uid ?? "", today),
    enabled: Boolean(uid) && Boolean(today),
    queryFn: async () => {
      const [{ data: streak, error: streakError }, { data: day, error: dayError }] =
        await Promise.all([
          supabase.rpc("get_my_streak"),
          supabase.rpc("get_workout_day", { p_date: today }),
        ]);
      if (streakError) throw streakError;
      if (dayError) throw new Error(dayError.message);

      const payload = day as unknown as {
        workout: Workout | null;
        exercises: WorkoutExercise[] | null;
        log: WorkoutLog | null;
      };

      return {
        workout: payload.workout,
        exercises: payload.exercises ?? [],
        log: payload.log,
        streak: streak ?? 0,
      };
    },
  });
}
