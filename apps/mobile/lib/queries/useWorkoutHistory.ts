import { useQuery } from "@tanstack/react-query";
import type { Session } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { STATIC_CACHE } from "./cachePolicy";
import type { WorkoutLogWithChildren } from "./useWorkoutDay";

export interface WorkoutHistoryResult {
  logs: WorkoutLogWithChildren[];
  /** Plain object, not a Map — see useDashboard.completedGoalIds: a Map does
   * not survive the persister's JSON round trip either. */
  sessionsById: Record<string, Session>;
}

/**
 * Completed workout_logs, most recent first, plus the sessions they
 * reference — for the estimated duration only.
 *
 * The NAME comes off the log itself: workout_logs.session_name snapshots it
 * at log time, so history renders the name the client was actually given and
 * keeps rendering after the session is rescheduled away (R8).
 *
 * Targets are NOT fetched: each set carries its own `prescribed` snapshot
 * from when it was logged. This used to join `workout_exercises` and match
 * targets back to sets by array position, so editing or reordering a workout
 * retroactively changed what past logs claimed the client was asked to do,
 * and deleting an exercise blanked its targets permanently (violations B5,
 * P-1, P-3). History now renders from the log alone.
 */
export function useWorkoutHistory(uid: string | undefined) {
  return useQuery<WorkoutHistoryResult>({
    ...STATIC_CACHE,
    queryKey: qk.workoutHistory(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data: logs, error: logsError } = await supabase
        .from("workout_logs")
        .select("*, exercise_logs(*, set_logs(*))")
        .eq("client_id", uid as string)
        .eq("completed", true)
        .order("date", { ascending: false });
      if (logsError) throw logsError;

      const sessionIds = [
        ...new Set((logs ?? []).map((l) => l.session_id).filter((id): id is string => Boolean(id))),
      ];

      const { data: sessions, error: sessionsError } =
        sessionIds.length > 0
          ? await supabase.from("sessions").select("*").in("id", sessionIds)
          : { data: [] as Session[], error: null };
      if (sessionsError) throw sessionsError;

      return {
        logs: (logs ?? []) as WorkoutLogWithChildren[],
        sessionsById: Object.fromEntries((sessions ?? []).map((s) => [s.id, s])),
      };
    },
  });
}
