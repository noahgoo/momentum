import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExerciseMode, SetConfig, WeightUnit } from "@momentum/shared";
import { serializeSetConfig, serializeSetConfigs } from "@momentum/shared";
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
  /** True only when the client actually typed a weight — see P2. */
  weightEntered?: boolean;
  /** This set's target as it stood right now; snapshotted onto the log. */
  prescribed?: SetConfig;
}

export interface ExerciseLogInput {
  exerciseId: string | null;
  exerciseName: string;
  mode: ExerciseMode;
  sortOrder: number;
  sets: SetLogInput[];
  /** The exercise's full target list at log time; snapshotted onto the log. */
  prescribed?: SetConfig[];
}

export interface SaveWorkoutLogInput {
  date: string;
  workoutId: string;
  exercises: ExerciseLogInput[];
  /** true = "Complete ✓" (all sets done); false = a background autosave. */
  completed: boolean;
  /** Only for cache invalidation — the server takes the client from auth.uid(). */
  clientId: string;
}

/**
 * Saves the whole log tree through the `save_workout_log` RPC: one round
 * trip, one transaction.
 *
 * This used to be an upsert, two deletes, and a loop of inserts per exercise
 * over separate connections — so a drop midway destroyed a completed workout
 * with nothing to roll back to (violation B7). The client no longer sends
 * client_id at all: the RPC reads auth.uid(), so a client can only ever log
 * their own work.
 *
 * Deliberately not optimistic: this writes a whole nested tree from an
 * explicit action, so there is no single cached value to flip. Callers show
 * their own saving state and rely on onSettled to reconcile.
 */
export function useSaveWorkoutLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ date, workoutId, exercises, completed }: SaveWorkoutLogInput) => {
      const { data, error } = await supabase.rpc("save_workout_log", {
        p_date: date,
        p_workout_id: workoutId,
        p_completed: completed,
        p_exercises: exercises.map((exercise) => ({
          exercise_id: exercise.exerciseId,
          exercise_name: exercise.exerciseName,
          mode: exercise.mode,
          sort_order: exercise.sortOrder,
          prescribed: exercise.prescribed ? serializeSetConfigs(exercise.prescribed) : null,
          sets: exercise.sets.map((set) => ({
            set_number: set.setNumber,
            completed: set.completed,
            reps: set.reps ?? null,
            weight: set.weight ?? null,
            weight_unit: set.weightUnit ?? null,
            target_seconds: set.targetSeconds ?? null,
            actual_seconds: set.actualSeconds ?? null,
            actual_miles: set.actualMiles ?? null,
            weight_entered: set.weightEntered ?? false,
            prescribed: set.prescribed ? serializeSetConfig(set.prescribed) : null,
          })),
        })),
      });
      if (error) throw new Error(error.message);
      return data;
    },

    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: qk.workoutDay(variables.clientId, variables.date),
      });
      void queryClient.invalidateQueries({ queryKey: qk.workoutWeek(variables.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.workoutHistory(variables.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.todayWorkout(variables.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(variables.clientId) });
    },
  });
}
