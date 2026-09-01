import { useQuery } from "@tanstack/react-query";
import type { GoalLog } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

/**
 * Goal completion logs for a client across an inclusive [fromDate, toDate]
 * range (both YYYY-MM-DD). Backs both today's checklist state and the
 * 7-day week chart — one range query covers both, avoiding a second
 * single-date fetch for "today" since today is always the last day in the
 * 7-day window the goals screen requests.
 */
export function useGoalLogsRange(
  clientId: string | undefined,
  fromDate: string,
  toDate: string
) {
  return useQuery<GoalLog[]>({
    queryKey: qk.goalLogsRange(clientId ?? "", fromDate, toDate),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goal_logs")
        .select("*")
        .eq("client_id", clientId as string)
        .gte("date", fromDate)
        .lte("date", toDate);
      if (error) throw error;
      return data ?? [];
    },
  });
}
