import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Exercise, ExerciseInsert } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/**
 * Coach's exercise library. No client-side `created_by` filter — RLS scopes
 * `exercises` reads to this coach's own rows already.
 */
export function useExercises() {
  return useQuery<Exercise[]>({
    queryKey: qk.exercises(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exercises")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExerciseInsert) => {
      const { data, error } = await supabase.from("exercises").insert(input).select("*").single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.exercises() });
    },
  });
}

export function useUpdateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ExerciseInsert> }) => {
      const { data, error } = await supabase
        .from("exercises")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.exercises() });
    },
  });
}

export function useDeleteExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exercises").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.exercises() });
    },
  });
}

/**
 * Per-exercise count of workouts referencing it (via `workout_exercises`),
 * for the library page's usage badge and delete-blocked messaging. Mirrors
 * `useWorkoutExerciseCounts` in `useWorkouts.ts`.
 */
export function useExerciseUsageCounts(exerciseIds: string[]) {
  return useQuery<Record<string, number>>({
    queryKey: qk.exerciseUsageCounts(exerciseIds),
    queryFn: async () => {
      if (exerciseIds.length === 0) return {};
      const { data, error } = await supabase
        .from("workout_exercises")
        .select("exercise_id")
        .in("exercise_id", exerciseIds);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        if (!row.exercise_id) continue;
        counts[row.exercise_id] = (counts[row.exercise_id] ?? 0) + 1;
      }
      return counts;
    },
    enabled: exerciseIds.length > 0,
  });
}
