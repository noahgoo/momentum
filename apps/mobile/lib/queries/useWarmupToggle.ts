import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface WarmupToggleInput {
  clientId: string;
  date: string;
  workoutId: string;
  completed: boolean;
}

/**
 * Toggles warmup_completed independently of the workout logger (plan finding
 * #5: "warmup tick creates stub log if none exists; warmup completion
 * independent of workout"). Upsert against the (client_id, date) unique
 * constraint so a first warmup tick on a day with no log yet creates a
 * minimal stub row rather than requiring the full logger to run first.
 */
export function useWarmupToggle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, date, workoutId, completed }: WarmupToggleInput) => {
      const { error } = await supabase.from("workout_logs").upsert(
        {
          client_id: clientId,
          date,
          workout_id: workoutId,
          warmup_completed: completed,
        },
        { onConflict: "client_id,date", ignoreDuplicates: false }
      );
      if (error) throw error;
    },

    onMutate: async ({ clientId, date, completed }) => {
      const key = qk.workoutDay(clientId, date);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (current: unknown) => {
        if (!current || typeof current !== "object") return current;
        const day = current as { log: { warmup_completed: boolean } | null };
        if (!day.log) return current;
        return { ...day, log: { ...day.log, warmup_completed: completed } };
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
    },
  });
}
