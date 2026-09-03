import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExerciseMode, SetConfig, WorkoutType } from "@momentum/shared";
import { describeRpcError, parseSetConfigs, serializeSetConfigs } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

export interface WorkoutDetailExercise {
  id: string;
  exerciseId: string | null;
  mode: ExerciseMode;
  setConfigs: SetConfig[];
  restSeconds: number | null;
  notes: string | null;
}

export interface WorkoutDetail {
  id: string;
  name: string;
  description: string | null;
  type: WorkoutType;
  estimatedDurationMinutes: number | null;
  equipment: string[];
  warmupId: string | null;
  /** Carried into the next save so a concurrent edit is detected (C3). */
  updatedAt: string;
  exercises: WorkoutDetailExercise[]; // ordered by sort_order
}

/** Loads one workout plus its ordered workout_exercises rows, for the builder's edit mode. */
export function useWorkoutDetail(workoutId: string | undefined) {
  return useQuery<WorkoutDetail | null>({
    queryKey: workoutId ? qk.workoutDetail(workoutId) : qk.workoutDetail("__none__"),
    queryFn: async () => {
      if (!workoutId) return null;

      const { data: workout, error: workoutError } = await supabase
        .from("workouts")
        .select("*")
        .eq("id", workoutId)
        .single();
      if (workoutError) throw workoutError;

      const { data: exercises, error: exercisesError } = await supabase
        .from("workout_exercises")
        .select("*")
        .eq("workout_id", workoutId)
        .order("sort_order", { ascending: true });
      if (exercisesError) throw exercisesError;

      return {
        id: workout.id,
        name: workout.name,
        description: workout.description,
        type: workout.type,
        estimatedDurationMinutes: workout.estimated_duration_minutes,
        equipment: workout.equipment ?? [],
        warmupId: workout.warmup_id,
        updatedAt: workout.updated_at,
        exercises: (exercises ?? []).map((ex) => ({
          id: ex.id,
          exerciseId: ex.exercise_id,
          mode: ex.mode,
          setConfigs: parseSetConfigs(ex.set_configs),
          restSeconds: ex.rest_seconds,
          notes: ex.notes,
        })),
      };
    },
    enabled: !!workoutId,
  });
}

/**
 * Builder-local shape for one exercise row: the fields the UI edits before
 * they're serialized down to a `workout_exercises` insert on save (via
 * `serializeSetConfigs`). `id` is a DB row id for rows loaded from the DB,
 * or a client-generated id for a row added in this editing session; the
 * save mutation doesn't need to distinguish them (it replaces all rows
 * wholesale — see `useSaveWorkout`), but the builder page uses `id` as each
 * row's stable drag identity for `SortableList` (array index is not a valid
 * drag identity — see `SortableList`'s `getId` contract).
 */
export interface BuilderExercise {
  id: string;
  exerciseId: string | null;
  exerciseName: string;
  mode: ExerciseMode;
  setConfigs: SetConfig[];
  restSeconds: number | null;
  notes: string | null;
}

export interface SaveWorkoutInput {
  workoutId?: string; // undefined => create
  type: WorkoutType;
  name: string;
  description: string;
  estimatedDurationMinutes: number | undefined;
  equipment: string[];
  warmupId: string | null;
  exercises: BuilderExercise[]; // in final display order
  createdBy: string;
  /** The workouts.updated_at this editor loaded; a competing save raises stale_write (C3). */
  expectedUpdatedAt?: string | null;
}

/** Domain wording for the codes save_workout raises. */
const SAVE_WORKOUT_ERRORS = {
  stale_write:
    "This workout changed while you were editing it. Reload to see the current version before saving.",
  not_found_or_forbidden: "This workout no longer exists.",
};

export function describeSaveWorkoutError(error: unknown): string {
  return describeRpcError(error, SAVE_WORKOUT_ERRORS);
}

/**
 * Saves a workout through the `save_workout` RPC.
 *
 * The old version updated the workout, deleted every workout_exercises row,
 * and reinserted — so each save handed every row a new primary key and,
 * across three separate requests, could leave a workout stripped of its
 * exercises if the connection dropped between them (B3, R2). The RPC
 * reconciles rows by (workout_id, sort_order) in one transaction, so
 * unchanged rows keep their ids.
 *
 * Passing `expectedUpdatedAt` (the value the editor loaded) makes a
 * concurrent edit raise `stale_write` instead of silently overwriting the
 * other coach's save (C3).
 */
export function useSaveWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveWorkoutInput) => {
      const { data, error } = await supabase.rpc("save_workout", {
        p_workout_id: input.workoutId ?? undefined,
        p_payload: {
          name: input.name,
          description: input.description || null,
          type: input.type,
          estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
          equipment: input.equipment.length > 0 ? input.equipment : null,
          warmup_id: input.warmupId,
          exercises: input.exercises.map((ex) => ({
            exercise_id: ex.exerciseId,
            mode: ex.mode,
            set_configs: serializeSetConfigs(ex.setConfigs),
            rest_seconds: ex.restSeconds,
            notes: ex.notes,
          })),
        },
        p_expected_updated_at: input.expectedUpdatedAt ?? undefined,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },

    onSuccess: (workoutId, input) => {
      void queryClient.invalidateQueries({ queryKey: qk.workoutDetail(workoutId) });
      void queryClient.invalidateQueries({
        queryKey: input.type === "warmup" ? qk.warmups() : qk.workouts(),
      });
    },
  });
}
