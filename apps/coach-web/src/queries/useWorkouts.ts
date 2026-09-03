import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Workout, WorkoutType } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/**
 * Coach's workout (or warmup) library list, filtered by `type`. No
 * client-side `created_by = auth.uid()` filter — RLS already scopes
 * `workouts` reads to rows this coach can see (own content), per the
 * README's rule against redundant coach filters.
 */
export function useWorkouts(type: WorkoutType) {
  return useQuery<Workout[]>({
    queryKey: type === "warmup" ? qk.warmups() : qk.workouts(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workouts")
        .select("*")
        .eq("type", type)
        .is("client_id", null)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Per-workout exercise counts, keyed by workout id, for the list cards. */
export function useWorkoutExerciseCounts(workoutIds: string[]) {
  return useQuery<Record<string, number>>({
    queryKey: qk.workoutExerciseCounts(workoutIds),
    queryFn: async () => {
      if (workoutIds.length === 0) return {};
      const { data, error } = await supabase
        .from("workout_exercises")
        .select("workout_id")
        .in("workout_id", workoutIds);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.workout_id] = (counts[row.workout_id] ?? 0) + 1;
      }
      return counts;
    },
    enabled: workoutIds.length > 0,
  });
}

function invalidateListsFor(type: WorkoutType) {
  return type === "warmup" ? qk.warmups() : qk.workouts();
}

/** Raised instead of a raw foreign-key error when a workout is still scheduled. */
export class WorkoutInUseError extends Error {
  constructor(public readonly scheduleCount: number) {
    super(
      scheduleCount === 1
        ? "This workout is scheduled on 1 day of a program."
        : `This workout is scheduled on ${scheduleCount} days across your programs.`
    );
    this.name = "WorkoutInUseError";
  }
}

/**
 * Deletes a workout (its workout_exercises cascade). Checks what depends on
 * it first so the coach sees which programs still schedule it rather than a
 * raw 23503 (R4). The FK is `on delete restrict`, so this is the message,
 * not the guard.
 */
export function useDeleteWorkout(type: WorkoutType) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workoutId: string) => {
      const { data: blockers, error: blockersError } = await supabase.rpc(
        "workout_delete_blockers",
        { p_workout_id: workoutId }
      );
      if (blockersError) throw new Error(blockersError.message);
      if ((blockers ?? 0) > 0) throw new WorkoutInUseError(blockers as number);

      const { error } = await supabase.from("workouts").delete().eq("id", workoutId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidateListsFor(type) });
    },
  });
}

/**
 * Duplicates a workout: copies the workout row (name suffixed " (copy)")
 * and every workout_exercises row, preserving sort_order and set_configs.
 */
export function useDuplicateWorkout(type: WorkoutType) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workoutId: string) => {
      const { data: source, error: sourceError } = await supabase
        .from("workouts")
        .select("*")
        .eq("id", workoutId)
        .single();
      if (sourceError) throw sourceError;

      const { data: sourceExercises, error: exercisesError } = await supabase
        .from("workout_exercises")
        .select("*")
        .eq("workout_id", workoutId)
        .order("sort_order", { ascending: true });
      if (exercisesError) throw exercisesError;

      const { data: inserted, error: insertError } = await supabase
        .from("workouts")
        .insert({
          name: `${source.name} (copy)`,
          description: source.description,
          type: source.type,
          estimated_duration_minutes: source.estimated_duration_minutes,
          equipment: source.equipment,
          warmup_id: source.warmup_id,
          created_by: source.created_by,
        })
        .select("*")
        .single();
      if (insertError) throw insertError;

      if (sourceExercises && sourceExercises.length > 0) {
        const { error: copyError } = await supabase.from("workout_exercises").insert(
          sourceExercises.map((ex) => ({
            workout_id: inserted.id,
            exercise_id: ex.exercise_id,
            sort_order: ex.sort_order,
            mode: ex.mode,
            set_configs: ex.set_configs,
            rest_seconds: ex.rest_seconds,
            notes: ex.notes,
          })),
        );
        if (copyError) throw copyError;
      }

      return inserted;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidateListsFor(type) });
    },
  });
}
