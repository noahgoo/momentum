import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WorkoutDifficulty } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface SetDifficultyInput {
  clientId: string;
  date: string;
  difficulty: WorkoutDifficulty;
}

/**
 * Patches `difficulty` onto an EXISTING completed log (plan finding #5:
 * "difficulty/next-day-feel patch existing log only"). Never upserts — the
 * completed-state difficulty picker only ever renders once a log row
 * already exists, so a plain UPDATE is the correct, narrower operation.
 */
export function useSetWorkoutDifficulty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, date, difficulty }: SetDifficultyInput) => {
      const { error } = await supabase
        .from("workout_logs")
        .update({ difficulty })
        .eq("client_id", clientId)
        .eq("date", date);
      if (error) throw error;
    },

    onMutate: async ({ clientId, date, difficulty }) => {
      const key = qk.workoutDay(clientId, date);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (current: unknown) => {
        if (!current || typeof current !== "object") return current;
        const day = current as { log: { difficulty: WorkoutDifficulty | null } | null };
        if (!day.log) return current;
        return { ...day, log: { ...day.log, difficulty } };
      });
      return { previous, key };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSettled: (_data, _error, { clientId, date }) => {
      void queryClient.invalidateQueries({ queryKey: qk.workoutDay(clientId, date) });
      void queryClient.invalidateQueries({ queryKey: qk.workoutHistory(clientId) });
    },
  });
}
