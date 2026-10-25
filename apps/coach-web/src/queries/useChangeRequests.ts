import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { describeScheduleMoveError } from "@momentum/shared";
import type { ChangeRequest, DecideScheduleMovesResult } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";
import { useRealtimeSubscription } from "./useRealtime";

/** History is one row per move and a batch can carry many, so this is larger than a per-request limit would be. */
const HISTORY_LIMIT = 60;

/** One move (a change_requests row), with display-only client/session names attached. */
export interface ChangeRequestRow extends ChangeRequest {
  clientName: string | null;
  workoutName: string | null;
}

export interface ChangeRequestsData {
  pending: ChangeRequestRow[];
  history: ChangeRequestRow[];
}

/** Human-readable text for a move RPC error or a stamped skip_reason. */
export const describeChangeRequestError = describeScheduleMoveError;

/** One client's moves filed together, so the coach can decide the lot or pick lines out of it. */
export interface MoveBatch {
  batchId: string;
  clientId: string;
  clientName: string | null;
  requestedAt: string;
  moves: ChangeRequestRow[];
}

/** Groups pending moves by the submission they arrived in: newest batch first, lines in filing order. */
export function groupIntoBatches(rows: ChangeRequestRow[]): MoveBatch[] {
  const byBatch = new Map<string, MoveBatch>();
  for (const row of rows) {
    const existing = byBatch.get(row.batch_id);
    if (existing) {
      existing.moves.push(row);
    } else {
      byBatch.set(row.batch_id, {
        batchId: row.batch_id,
        clientId: row.client_id,
        clientName: row.clientName,
        requestedAt: row.requested_at,
        moves: [row],
      });
    }
  }
  const batches = [...byBatch.values()];
  for (const batch of batches) batch.moves.sort((a, b) => a.position - b.position);
  return batches.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/**
 * Loads the coach's pending moves plus the most recent decided ones, with the
 * client's display name (from `client_summaries`) and the session name
 * attached for display only.
 *
 * `session_name` on a row is a snapshot taken when the client filed the move;
 * it is never re-resolved here. Whether the move can still apply is decided
 * inside `decide_schedule_moves`, against the live schedule, when the coach
 * acts (C5) — `resolve_scheduled_workout` is not callable from the browser
 * anyway.
 *
 * No client-side `coach_id = auth.uid()` filter — RLS already scopes
 * `change_requests` SELECT to `coach_id = auth.uid()` (0006).
 */
export function useChangeRequests() {
  const queryClient = useQueryClient();

  // R6: a client filing, withdrawing or auto-applying a move reaches the coach
  // without a refresh. RLS scopes the events to this coach's own rows.
  useRealtimeSubscription({
    table: "change_requests",
    onChange: () => {
      void queryClient.invalidateQueries({ queryKey: qk.changeRequests() });
    },
  });

  return useQuery<ChangeRequestsData>({
    queryKey: qk.changeRequests(),
    queryFn: async () => {
      const [pendingRes, historyRes] = await Promise.all([
        supabase
          .from("change_requests")
          .select("*")
          .eq("status", "pending")
          .order("requested_at", { ascending: false })
          .order("position", { ascending: true }),
        supabase
          .from("change_requests")
          .select("*")
          .in("status", ["accepted", "rejected", "cancelled", "skipped"])
          .order("responded_at", { ascending: false })
          .limit(HISTORY_LIMIT),
      ]);

      if (pendingRes.error) throw pendingRes.error;
      if (historyRes.error) throw historyRes.error;

      const pending = pendingRes.data ?? [];
      const history = historyRes.data ?? [];
      const all = [...pending, ...history];

      const clientIds = [...new Set(all.map((r) => r.client_id))];
      const sessionIds = [...new Set(all.map((r) => r.session_id).filter((v): v is string => Boolean(v)))];

      const [clientsRes, sessionsRes] = await Promise.all([
        clientIds.length > 0
          ? supabase.from("client_summaries").select("client_id, display_name").in("client_id", clientIds)
          : Promise.resolve({ data: [], error: null }),
        sessionIds.length > 0
          ? supabase.from("sessions").select("id, name").in("id", sessionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (clientsRes.error) throw clientsRes.error;
      if (sessionsRes.error) throw sessionsRes.error;

      const nameByClientId = new Map((clientsRes.data ?? []).map((c) => [c.client_id, c.display_name]));
      const nameBySessionId = new Map((sessionsRes.data ?? []).map((s) => [s.id, s.name]));

      // Snapshot first (R8): the name the client was given, which survives the
      // session being rebuilt. The live name is only a fallback for rows filed
      // before the snapshot existed.
      const attach = (r: ChangeRequest): ChangeRequestRow => ({
        ...r,
        clientName: nameByClientId.get(r.client_id) ?? null,
        workoutName: r.session_name ?? (r.session_id ? (nameBySessionId.get(r.session_id) ?? null) : null),
      });

      return {
        pending: pending.map(attach),
        history: history.map(attach),
      };
    },
  });
}

/**
 * Decides any subset of pending moves in one call. The RPC re-checks every
 * line inside its transaction, so a double click or a stale list cannot apply
 * anything twice; the result says how many applied and which lines were
 * skipped and why, and the caller shows that rather than claiming success.
 *
 * Invalidates the coach's request list (which also feeds the inbox count).
 * The client-side counterparts — week, day and pending-move keys in
 * apps/mobile — are refreshed by realtime on change_requests (R6).
 */
export function useDecideScheduleMoves() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, decision }: { ids: string[]; decision: "accept" | "reject" }) => {
      const { data, error } = await supabase.rpc("decide_schedule_moves", {
        p_ids: ids,
        p_decision: decision,
      });
      if (error) throw new Error(error.message);
      return data as unknown as DecideScheduleMovesResult;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.changeRequests() });
    },
  });
}
