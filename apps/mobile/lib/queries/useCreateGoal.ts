import { useMutation, useQueryClient } from "@tanstack/react-query";
import { goalCreateSchema, type Goal } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface CreateGoalInput {
  clientId: string;
  text: string;
}

/**
 * Creates a self-set goal: `set_by = clientId` (the caller), `locked = false`
 * always — clients can only ever create unlocked goals for themselves (coach
 * lock management is out of scope here, see 8.3 non-goals). Validated
 * against the shared `goalCreateSchema` before hitting the network so a bad
 * payload never round-trips.
 */
export function useCreateGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, text }: CreateGoalInput) => {
      const parsed = goalCreateSchema.parse({ text });

      const { data, error } = await supabase
        .from("goals")
        .insert({
          client_id: clientId,
          text: parsed.text,
          set_by: clientId,
          locked: false,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },

    onMutate: async ({ clientId, text }) => {
      const key = qk.goals(clientId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<Goal[]>(key);

      const optimisticGoal: Goal = {
        id: `optimistic-${Date.now()}`,
        client_id: clientId,
        text,
        set_by: clientId,
        locked: false,
        active: true,
        created_at: new Date().toISOString(),
        archived_at: null,
        archived_by: null,
      };
      queryClient.setQueryData<Goal[]>(key, (current = []) => [...current, optimisticGoal]);

      return { previous, key };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.goals(clientId) });
    },
  });
}
