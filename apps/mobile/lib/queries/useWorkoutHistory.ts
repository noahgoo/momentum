import { useQuery } from "@tanstack/react-query";
import type { Workout } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { STATIC_CACHE } from "./cachePolicy";
import type { WorkoutLogWithChildren } from "./useWorkoutDay";

export interface WorkoutHistoryResult {
  logs: WorkoutLogWithChildren[];
  workoutsById: Map<string, Workout>;
}

/**
 * Completed workout_logs, most recent first, plus the workouts they
 * reference — for the workout NAME only.
 *
 * Targets are NOT fetched: each set carries its own `prescribed` snapshot
 * from when it was logged. This used to join `workout_exercises` and match
 * targets back to sets by array position, so editing or reordering a workout
 * retroactively changed what past logs claimed the client was asked to do,
 * and deleting an exercise blanked its targets permanently (violations B5,
 * P-1, P-3). History now renders from the log alone.
 */
export function useWorkoutHistory(uid: string | undefined) {
  return useQuery<WorkoutHistoryResult>({
    ...STATIC_CACHE,
    queryKey: qk.workoutHistory(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data: logs, error: logsError } = await supabase
        .from("workout_logs")
        .select("*, exercise_logs(*, set_logs(*))")
        .eq("client_id", uid as string)
        .eq("completed", true)
        .order("date", { ascending: false });
      if (logsError) throw logsError;

      const workoutIds = [
        ...new Set((logs ?? []).map((l) => l.workout_id).filter((id): id is string => Boolean(id))),
      ];

      const { data: workouts, error: workoutsError } =
        workoutIds.length > 0
          ? await supabase.from("workouts").select("*").in("id", workoutIds)
          : { data: [] as Workout[], error: null };
      if (workoutsError) throw workoutsError;

      return {
        logs: (logs ?? []) as WorkoutLogWithChildren[],
        workoutsById: new Map((workouts ?? []).map((w) => [w.id, w])),
      };
    },
  });
}
