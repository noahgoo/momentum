import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface WarmupToggleInput {
  /** Only for cache keys — the server takes the client from auth.uid(). */
  clientId: string;
  date: string;
  completed: boolean;
}

/**
 * Toggles warmup_completed, independently of workout completion — finishing
 * the warm-up and finishing the workout are separate facts and neither gates
 * the other (docs/rules/notifications.md W2).
 *
 * Goes through the `set_warmup_completed` RPC rather than upserting
 * workout_logs directly. Two hooks upserting the same (client_id, date) row
 * with different column sets was a latent clobber (violation W-1), and the
 * client-side version could also create a stub log for a rest day. The RPC
 * patches an existing row by id and only creates a stub when the date is
 * actually scheduled.
 */
export function useWarmupToggle() {
  const queryClient = useQueryClient();

  return useMutation({
    // Keyed so an offline write replays after a restart (mutationDefaults.ts).
    mutationKey: ["setWarmupCompleted"],
    mutationFn: async ({ date, completed }: WarmupToggleInput) => {
      const { error } = await supabase.rpc("set_warmup_completed", {
        p_date: date,
        p_completed: completed,
      });
      if (error) throw new Error(error.message);
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
