import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExerciseMode, WeightUnit } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface SetLogInput {
  setNumber: number;
  completed: boolean;
  reps?: number;
  weight?: number;
  weightUnit?: WeightUnit;
  targetSeconds?: number;
  actualSeconds?: number;
  actualMiles?: number;
}

export interface ExerciseLogInput {
  exerciseId: string | null;
  exerciseName: string;
  mode: ExerciseMode;
  sortOrder: number;
  sets: SetLogInput[];
}

export interface SaveWorkoutLogInput {
  clientId: string;
  date: string;
  workoutId: string;
  exercises: ExerciseLogInput[];
  /** true = "Complete ✓" (all sets done); false = "Save progress" (partial). */
  completed: boolean;
  /** Carries forward warmup_completed on an existing log; omit to leave unset (false) on a new log. */
  warmupCompleted?: boolean;
}

/**
 * Upserts a workout_log for (client_id, date), then replaces its
 * exercise_logs/set_logs children wholesale: delete existing children of
 * this log, reinsert from the current form state. Plan/constraint #5 calls
 * this out explicitly as "fine and simple" — avoids diffing set-by-set.
 *
 * Not written as an optimistic mutation (unlike useToggleGoalLog): this
 * writes a whole nested tree in one submit action (explicit Save/Complete
 * button, not a tap-to-toggle), so instant optimistic UI has little value
 * here and the multi-statement replace-on-save shape doesn't fit the
 * onMutate snapshot/rollback pattern cleanly. Callers should show their own
 * pending/saving state (see WorkoutLogger) and rely on onSettled
 * invalidation to reconcile.
 */
export function useSaveWorkoutLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveWorkoutLogInput) => {
      const { clientId, date, workoutId, exercises, completed, warmupCompleted } = input;

      const { data: log, error: upsertError } = await supabase
        .from("workout_logs")
        .upsert(
          {
            client_id: clientId,
            date,
            workout_id: workoutId,
            completed,
            completed_at: completed ? new Date().toISOString() : null,
            ...(warmupCompleted !== undefined ? { warmup_completed: warmupCompleted } : {}),
          },
          { onConflict: "client_id,date" }
        )
        .select()
        .single();
      if (upsertError) throw upsertError;

      // Replace-on-save: wipe this log's existing children (cascades to
      // set_logs via exercise_log_id FK on delete? No ON DELETE CASCADE is
      // assumed here — delete children explicitly in dependency order to be
      // safe regardless of the migration's cascade setting).
      const { data: existingExerciseLogs, error: fetchExError } = await supabase
        .from("exercise_logs")
        .select("id")
        .eq("workout_log_id", log.id);
      if (fetchExError) throw fetchExError;

      const existingExerciseLogIds = (existingExerciseLogs ?? []).map((e) => e.id);
      if (existingExerciseLogIds.length > 0) {
        const { error: deleteSetsError } = await supabase
          .from("set_logs")
          .delete()
          .in("exercise_log_id", existingExerciseLogIds);
        if (deleteSetsError) throw deleteSetsError;

        const { error: deleteExError } = await supabase
          .from("exercise_logs")
          .delete()
          .eq("workout_log_id", log.id);
        if (deleteExError) throw deleteExError;
      }

      for (const exercise of exercises) {
        const { data: exerciseLog, error: exInsertError } = await supabase
          .from("exercise_logs")
          .insert({
            workout_log_id: log.id,
            exercise_id: exercise.exerciseId,
            exercise_name: exercise.exerciseName,
            mode: exercise.mode,
            sort_order: exercise.sortOrder,
          })
          .select()
          .single();
        if (exInsertError) throw exInsertError;

        if (exercise.sets.length > 0) {
          const { error: setsInsertError } = await supabase.from("set_logs").insert(
            exercise.sets.map((set) => ({
              exercise_log_id: exerciseLog.id,
              set_number: set.setNumber,
              completed: set.completed,
              reps: set.reps ?? null,
              weight: set.weight ?? null,
              weight_unit: set.weightUnit ?? null,
              target_seconds: set.targetSeconds ?? null,
              actual_seconds: set.actualSeconds ?? null,
              actual_miles: set.actualMiles ?? null,
            }))
          );
          if (setsInsertError) throw setsInsertError;
        }
      }

      return log;
    },

    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: qk.workoutDay(variables.clientId, variables.date),
      });
      void queryClient.invalidateQueries({ queryKey: ["workoutWeek", variables.clientId] });
      void queryClient.invalidateQueries({ queryKey: qk.workoutHistory(variables.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.todayWorkout(variables.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(variables.clientId) });
    },
  });
}
