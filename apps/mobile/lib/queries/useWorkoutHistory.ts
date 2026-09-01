import { useQuery } from "@tanstack/react-query";
import type { Workout } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import type { WorkoutLogWithChildren, WorkoutExerciseWithName } from "./useWorkoutDay";

export interface WorkoutHistoryResult {
  logs: WorkoutLogWithChildren[];
  workoutsById: Map<string, Workout>;
  /** workout_exercises for every referenced workout — used to show each set's
   * TARGET weight (exercise_logs/set_logs only carry what was actually logged,
   * not the coach-prescribed target). Keyed by workout_id, then exercise_id. */
  workoutExercisesByWorkoutId: Map<string, Map<string, WorkoutExerciseWithName>>;
}

/**
 * Completed workout_logs, most recent first, plus the distinct workouts
 * referenced by them (batched into one `.in()` fetch rather than N+1). The
 * history screen slices this to the collapsed-15 view client-side.
 */
export function useWorkoutHistory(uid: string | undefined) {
  return useQuery<WorkoutHistoryResult>({
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

      const [{ data: workouts, error: workoutsError }, { data: workoutExercises, error: exercisesError }] =
        workoutIds.length > 0
          ? await Promise.all([
              supabase.from("workouts").select("*").in("id", workoutIds),
              supabase
                .from("workout_exercises")
                .select("*, exercises(name, video_url)")
                .in("workout_id", workoutIds),
            ])
          : [
              { data: [] as Workout[], error: null },
              { data: [] as WorkoutExerciseWithName[], error: null },
            ];
      if (workoutsError) throw workoutsError;
      if (exercisesError) throw exercisesError;

      const workoutExercisesByWorkoutId = new Map<string, Map<string, WorkoutExerciseWithName>>();
      for (const we of (workoutExercises ?? []) as WorkoutExerciseWithName[]) {
        if (!we.exercise_id) continue;
        if (!workoutExercisesByWorkoutId.has(we.workout_id)) {
          workoutExercisesByWorkoutId.set(we.workout_id, new Map());
        }
        workoutExercisesByWorkoutId.get(we.workout_id)!.set(we.exercise_id, we);
      }

      return {
        logs: (logs ?? []) as WorkoutLogWithChildren[],
        workoutsById: new Map((workouts ?? []).map((w) => [w.id, w])),
        workoutExercisesByWorkoutId,
      };
    },
  });
}
