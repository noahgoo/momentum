import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Goal } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface ArchiveGoalInput {
  goalId: string;
  clientId: string;
}

/**
 * Soft-archives a goal (plan finding #6: NEVER delete). Sets `active: false`,
 * `archived_at: now()`, `archived_by: clientId`. `goal_logs` rows are
 * untouched — the week view keeps showing this goal's history via the log's
 * `goal_text` snapshot even after it disappears from the active checklist.
 *
 * Callers are responsible for only offering this on the client's own
 * unlocked goals — locked/coach goals are not archivable from the client
 * app (coach lock management is out of scope, see 8.3 non-goals). RLS is
 * the actual enforcement boundary; this hook doesn't re-check locked/isOwn.
 */
export function useArchiveGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ goalId, clientId }: ArchiveGoalInput) => {
      const { error } = await supabase
        .from("goals")
        .update({
          active: false,
          archived_at: new Date().toISOString(),
          archived_by: clientId,
        })
        .eq("id", goalId);
      if (error) throw error;
    },

    onMutate: async ({ goalId, clientId }) => {
      const key = qk.goals(clientId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<Goal[]>(key);
      queryClient.setQueryData<Goal[]>(key, (current = []) =>
        current.filter((g) => g.id !== goalId)
      );

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
