import { useQuery } from "@tanstack/react-query";
import type { Goal } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

/**
 * Goals for a client (coach-set + self-set, locked + unlocked).
 *
 * `includeArchived` pulls back soft-archived goals (`active: false`) too —
 * the week-view detail panel needs those so a day can still show "done" for
 * a goal the client has since archived (plan finding #6: soft-archive only,
 * history stays intact). The checklist/ring only want the active set, so
 * they call this with the default (`false`).
 */
export function useGoals(clientId: string | undefined, includeArchived = false) {
  return useQuery<Goal[]>({
    queryKey: includeArchived ? [...qk.goals(clientId ?? ""), "all"] : qk.goals(clientId ?? ""),
    enabled: Boolean(clientId),
    queryFn: async () => {
      let query = supabase
        .from("goals")
        .select("*")
        .eq("client_id", clientId as string)
        .order("created_at", { ascending: true });
      if (!includeArchived) {
        query = query.eq("active", true);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}
