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
