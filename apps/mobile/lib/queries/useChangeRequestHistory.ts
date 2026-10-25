import { useQuery } from "@tanstack/react-query";
import type { ChangeRequest } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

const HISTORY_LIMIT = 5;

/**
 * This client's own change_requests, any status, most recent 5 first
 * (settings.tsx "Requests" card). Distinct from `useMovableDays`
 * (useScheduleMoves.ts), which carries the pending moves for the reschedule
 * screen — this is a read-only history list, no accept/reject actions here
 * (those are the coach-side decide_schedule_moves RPC).
 */
export function useChangeRequestHistory(uid: string | undefined) {
  return useQuery<ChangeRequest[]>({
    queryKey: qk.changeRequestHistory(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("change_requests")
        .select("*")
        .eq("client_id", uid as string)
        .order("requested_at", { ascending: false })
        .limit(HISTORY_LIMIT);

      if (error) throw error;
      return data ?? [];
    },
  });
}
