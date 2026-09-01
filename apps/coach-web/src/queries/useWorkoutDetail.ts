import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExerciseMode, SetConfig, WorkoutType } from "@momentum/shared";
import { parseSetConfigs, serializeSetConfigs } from "@momentum/shared";
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
}

/**
 * Saves a workout: insert/update the `workouts` row, then replace its
 * `workout_exercises` rows wholesale — delete every existing row for this
 * workout, then insert the kept/added rows in one batch with `sort_order`
 * reindexed to 0..n-1 from final display order. `workout_exercises` carries
 * `unique (workout_id, sort_order) deferrable initially deferred`
 * specifically so this delete-then-insert round trip (and, more generally,
 * any reorder) never trips the uniqueness constraint on intermediate states
 * — Postgres only checks a DEFERRABLE constraint at transaction commit.
 *
 * Delete-then-batch-insert (rather than per-row update) is deliberate: a
 * dropped row's id is simply not carried into the new insert, and a
 * reordered/edited row gets a fresh id with its new `sort_order` — there is
 * no need to diff old vs. new rows to decide update vs. insert vs. delete
 * per row. This assumes nothing else references `workout_exercises.id`
 * across a save (true today: no FK points at it, and set/exercise logs key
 * off `workout_id` + `exercise_id`, not this join row's id).
 */
export function useSaveWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveWorkoutInput) => {
      const workoutPayload = {
        name: input.name,
        description: input.description || null,
        type: input.type,
        estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
        equipment: input.equipment.length > 0 ? input.equipment : null,
        warmup_id: input.warmupId,
        created_by: input.createdBy,
      };

      let workoutId = input.workoutId;
      if (workoutId) {
        const { error } = await supabase.from("workouts").update(workoutPayload).eq("id", workoutId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("workouts")
          .insert(workoutPayload)
          .select("id")
          .single();
        if (error) throw error;
        workoutId = data.id;
      }

      const { error: deleteError } = await supabase
        .from("workout_exercises")
        .delete()
        .eq("workout_id", workoutId);
      if (deleteError) throw deleteError;

      if (input.exercises.length > 0) {
        const { error: insertError } = await supabase.from("workout_exercises").insert(
          input.exercises.map((ex, index) => ({
            workout_id: workoutId,
            exercise_id: ex.exerciseId,
            sort_order: index,
            // mode is NOT NULL with no absent-means-reps fallback (constraint
            // #12) — always write it explicitly, never omit the field.
            mode: ex.mode,
            set_configs: serializeSetConfigs(ex.setConfigs),
            rest_seconds: ex.restSeconds,
            notes: ex.notes,
          })),
        );
        if (insertError) throw insertError;
      }

      return workoutId;
    },
    onSuccess: (workoutId, input) => {
      void queryClient.invalidateQueries({ queryKey: qk.workoutDetail(workoutId) });
      void queryClient.invalidateQueries({
        queryKey: input.type === "warmup" ? qk.warmups() : qk.workouts(),
      });
    },
  });
}
