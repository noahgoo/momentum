import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Goal, GoalLog } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface ToggleGoalLogInput {
  goal: Pick<Goal, "id" | "text">;
  clientId: string;
  /** YYYY-MM-DD, device-local "today" (or whatever date is being toggled). */
  date: string;
  /** Current logged state for this goal+date, so the mutation knows insert vs delete. */
  isLogged: boolean;
}

/**
 * EXEMPLAR optimistic mutation — read this before writing any other
 * write-hook in this directory. The three-part shape (onMutate / onError /
 * onSettled) below is the pattern every mutation in this app follows.
 *
 * Toggle semantics (plan finding #6): goals are logged idempotently.
 * - Logging ON: `upsert` with `onConflict: 'goal_id,date'` and
 *   `ignoreDuplicates: true`. A second rapid tap (double-tap race) is a
 *   no-op instead of a unique-violation error — this IS the idempotency
 *   contract, not a workaround.
 * - Logging OFF: plain `delete` matched on (goal_id, date). Deleting a
 *   row that's already gone is not an error either.
 * `goal_text` is snapshotted onto the log row at insert time (so a later
 * edit/archive of the goal's text doesn't rewrite history).
 */
export function useToggleGoalLog() {
  const queryClient = useQueryClient();

  return useMutation({
    // Keyed so an offline write replays after a restart (mutationDefaults.ts).
    mutationKey: ["toggleGoalLog"],
    mutationFn: async ({ goal, clientId, date, isLogged }: ToggleGoalLogInput) => {
      if (isLogged) {
        const { error } = await supabase
          .from("goal_logs")
          .delete()
          .eq("goal_id", goal.id)
          .eq("date", date);
        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from("goal_logs")
        .upsert(
          { goal_id: goal.id, client_id: clientId, date, goal_text: goal.text },
          { onConflict: "goal_id,date", ignoreDuplicates: true }
        );
      if (error) throw error;
    },

    // Optimistic update: flip the cached log list immediately so the UI
    // reacts before the network round trip completes.
    onMutate: async ({ goal, clientId, date, isLogged }) => {
      const key = qk.goalLogs(clientId, date);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<GoalLog[]>(key);

      queryClient.setQueryData<GoalLog[]>(key, (current = []) => {
        if (isLogged) {
          return current.filter((log) => log.goal_id !== goal.id);
        }
        if (current.some((log) => log.goal_id === goal.id)) return current;
        const optimisticLog: GoalLog = {
          id: `optimistic-${goal.id}-${date}`,
          goal_id: goal.id,
          client_id: clientId,
          date,
          goal_text: goal.text,
          completed_at: new Date().toISOString(),
        };
        return [...current, optimisticLog];
      });

      // Context handed to onError for rollback.
      return { previous, key };
    },

    // Rollback: restore the exact snapshot taken in onMutate. Never try to
    // "undo" the optimistic change by re-deriving it — the snapshot is the
    // only trustworthy prior state.
    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    // Always reconcile with the server on settle (success or failure) so
    // the optimistic-id row above is replaced with the real row / any
    // concurrent server-side change is picked up.
    onSettled: (_data, _error, { clientId, date }) => {
      void queryClient.invalidateQueries({ queryKey: qk.goalLogs(clientId, date) });
    },
  });
}
