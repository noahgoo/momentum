import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeRequest } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

const HISTORY_LIMIT = 20;

/** A pending/accepted/rejected change request, with display-only client/workout names attached. */
export interface ChangeRequestRow extends ChangeRequest {
  clientName: string | null;
  workoutName: string | null;
}

export interface ChangeRequestsData {
  pending: ChangeRequestRow[];
  history: ChangeRequestRow[];
}

/** Human-readable messages for the RPC error strings raised by accept_change_request/reject_change_request (0013/0015). */
const RPC_ERROR_MESSAGES: Record<string, string> = {
  not_found_or_forbidden: "This request was already handled.",
  no_active_assignment: "This client no longer has an active program.",
  nothing_to_move: "That workout is no longer on the original day.",
};

/** Maps a raised RPC error string to a human-readable message; falls back to the raw message for anything unrecognized. */
export function describeChangeRequestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return RPC_ERROR_MESSAGES[message] ?? message;
}

/**
 * Loads the coach's pending change requests (oldest-request-first UI actually
 * wants newest-first per spec) plus the most recent 20 accepted/rejected, with
 * client display name (from `client_summaries`) and workout name (from
 * `workouts`, keyed by the request's stored `workout_id`) attached for
 * display only.
 *
 * NOTE: the stored `workout_id` on a request is a snapshot taken when the
 * client filed the request — it is NEVER re-resolved here. Constraint #3
 * (plan) requires accept/reject to re-resolve live via
 * `resolve_scheduled_workout`, but that function is only callable from other
 * SECURITY DEFINER functions (revoked from `authenticated` — see 0011), so
 * this page cannot and does not attempt to re-resolve it client-side. It is
 * display-only context for the coach; the actual swap math happens entirely
 * inside `accept_change_request`'s SQL.
 *
 * No client-side `coach_id = auth.uid()` filter — RLS already scopes
 * `change_requests` SELECT to `coach_id = auth.uid()` (0006).
 */
export function useChangeRequests() {
  return useQuery<ChangeRequestsData>({
    queryKey: qk.changeRequests(),
    queryFn: async () => {
      const [pendingRes, historyRes] = await Promise.all([
        supabase
          .from("change_requests")
          .select("*")
          .eq("status", "pending")
          .order("requested_at", { ascending: false }),
        supabase
          .from("change_requests")
          .select("*")
          .in("status", ["accepted", "rejected"])
          .order("responded_at", { ascending: false })
          .limit(HISTORY_LIMIT),
      ]);

      if (pendingRes.error) throw pendingRes.error;
      if (historyRes.error) throw historyRes.error;

      const pending = pendingRes.data ?? [];
      const history = historyRes.data ?? [];
      const all = [...pending, ...history];

      const clientIds = [...new Set(all.map((r) => r.client_id))];
      const workoutIds = [...new Set(all.map((r) => r.workout_id).filter((v): v is string => Boolean(v)))];

      const [clientsRes, workoutsRes] = await Promise.all([
        clientIds.length > 0
          ? supabase.from("client_summaries").select("client_id, display_name").in("client_id", clientIds)
          : Promise.resolve({ data: [], error: null }),
        workoutIds.length > 0
          ? supabase.from("workouts").select("id, name").in("id", workoutIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (clientsRes.error) throw clientsRes.error;
      if (workoutsRes.error) throw workoutsRes.error;

      const nameByClientId = new Map((clientsRes.data ?? []).map((c) => [c.client_id, c.display_name]));
      const nameByWorkoutId = new Map((workoutsRes.data ?? []).map((w) => [w.id, w.name]));

      const attach = (r: ChangeRequest): ChangeRequestRow => ({
        ...r,
        clientName: nameByClientId.get(r.client_id) ?? null,
        workoutName: r.workout_id ? (nameByWorkoutId.get(r.workout_id) ?? null) : null,
      });

      return {
        pending: pending.map(attach),
        history: history.map(attach),
      };
    },
  });
}

/**
 * Accept/decline share the same shape: call the RPC, invalidate the list on
 * settle regardless of outcome (constraint #3 — double-click safe, since a
 * second call on an already-handled row cleanly raises
 * not_found_or_forbidden rather than throwing something unrecoverable; the
 * invalidation on settle picks up whatever the first call actually did).
 */
function useChangeRequestAction(rpcName: "accept_change_request" | "reject_change_request") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc(rpcName, { p_request_id: requestId });
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.changeRequests() });
    },
  });
}

export function useAcceptChangeRequest() {
  return useChangeRequestAction("accept_change_request");
}

export function useRejectChangeRequest() {
  return useChangeRequestAction("reject_change_request");
}
