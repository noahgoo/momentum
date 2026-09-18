import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Goal, GoalLog } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import type { DashboardResult } from "./useDashboard";

interface ToggleGoalLogInput {
  goal: Pick<Goal, "id" | "text">;
  clientId: string;
  /** YYYY-MM-DD, the client's local date being toggled (never a device clock — C1). */
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
 *
 * WRITE TO EVERY READER, NOT ONE KEY. This hook used to touch only
 * `qk.goalLogs(clientId, date)`. No screen reads that key: the goals screen
 * reads `qk.goalLogsRange` and the dashboard reads `qk.dashboard`, and
 * `['goals',uid,'logs',date]` is NOT a prefix of
 * `['goals',uid,'logs','range',from,to]` — index 3 would have to be the
 * literal 'range'. So nothing repainted, nothing refetched, and the caller's
 * `isLogged` stayed stale forever, which turned every subsequent tap into an
 * `ignoreDuplicates` no-op that never errored. The goal could be checked but
 * never unchecked, and neither appeared to do anything.
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

    // Optimistic update: flip every cached view of this log immediately so the
    // UI reacts before the network round trip completes.
    onMutate: async ({ goal, clientId, date, isLogged }) => {
      // `['goals', uid, 'logs']` is the prefix shared by the single-date key
      // and every mounted range key, so one cancel covers both shapes.
      const logsPrefix = [...qk.goals(clientId), "logs"];
      const dashboardKey = qk.dashboard(clientId, date);

      await queryClient.cancelQueries({ queryKey: logsPrefix });
      await queryClient.cancelQueries({ queryKey: dashboardKey });

      const previousLogs = queryClient.getQueriesData<GoalLog[]>({ queryKey: logsPrefix });
      const previousDashboard = queryClient.getQueryData<DashboardResult>(dashboardKey);

      queryClient.setQueriesData<GoalLog[]>({ queryKey: logsPrefix }, (current) => {
        if (!current) return current;
        if (isLogged) {
          // Match on goal AND date. A range query holds seven days at once, so
          // filtering on goal_id alone would wipe this goal from the whole week.
          return current.filter((log) => !(log.goal_id === goal.id && log.date === date));
        }
        if (current.some((log) => log.goal_id === goal.id && log.date === date)) return current;
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

      // The dashboard keeps its own derived Set rather than the raw rows, so
      // it needs its own patch — without this the dashboard's checkbox stays
      // visually dead for the whole round trip.
      queryClient.setQueryData<DashboardResult>(dashboardKey, (current) => {
        if (!current) return current;
        const completedGoalIds = new Set(current.completedGoalIds);
        if (isLogged) completedGoalIds.delete(goal.id);
        else completedGoalIds.add(goal.id);
        return { ...current, completedGoalIds };
      });

      // Context handed to onError for rollback.
      return { previousLogs, previousDashboard, dashboardKey };
    },

    // Rollback: restore the exact snapshot taken in onMutate. Never try to
    // "undo" the optimistic change by re-deriving it — the snapshot is the
    // only trustworthy prior state.
    onError: (_err, _variables, context) => {
      for (const [key, data] of context?.previousLogs ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (context?.previousDashboard !== undefined) {
        queryClient.setQueryData(context.dashboardKey, context.previousDashboard);
      }
    },

    // Always reconcile with the server on settle (success or failure) so the
    // optimistic-id row above is replaced with the real row / any concurrent
    // server-side change is picked up. `qk.goals(clientId)` is the prefix that
    // covers the goal list, the single-date logs and every range key — the
    // same prefix useCreateGoal/useArchiveGoal already invalidate, which is
    // why add and archive worked while this hook did not.
    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.goals(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
