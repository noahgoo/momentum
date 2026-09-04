import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { changeRequestCreateSchema, type ChangeRequest } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

/**
 * This client's pending change_requests row, if any. Plan constraint: at
 * most one pending request per client (partial unique index on
 * `client_id WHERE status = 'pending'`) — there is no list, just this one
 * optional row.
 */
export function usePendingChangeRequest(uid: string | undefined) {
  return useQuery<ChangeRequest | null>({
    queryKey: qk.changeRequest(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("change_requests")
        .select("*")
        .eq("client_id", uid as string)
        .eq("status", "pending")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export class DuplicatePendingRequestError extends Error {
  constructor() {
    super("You already have a pending request.");
    this.name = "DuplicatePendingRequestError";
  }
}

interface CreateChangeRequestInput {
  clientId: string;
  coachId: string;
  fromDate: string;
  toDate: string;
  /** Workout currently resolved for `fromDate` — what's being moved. */
  workoutId: string | null;
}

/**
 * Creates a move request (MoveWorkoutCard "send"). No accept/reject/cancel
 * here — mobile only creates the request; the coach portal actions it via
 * the accept_change_request/reject_change_request RPCs (plan finding #3).
 * There's no cancel path either (no delete policy on change_requests) — a
 * client who sends a request just waits.
 *
 * Postgres error 23505 (unique_violation) on the partial unique index means
 * a pending request already exists — surfaced as the friendly
 * DuplicatePendingRequestError per the slice brief, not the raw Postgres
 * message.
 */
export function useCreateChangeRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    // Deliberately not queued offline: the request is about what is scheduled
    // right now, and the one-pending-per-client constraint is checked
    // server-side. Replaying a stale request would ask the coach to move a
    // workout that has since moved. Fail fast instead (S3).
    networkMode: "online",
    mutationFn: async (input: CreateChangeRequestInput) => {
      const parsed = changeRequestCreateSchema.safeParse({
        fromDate: input.fromDate,
        toDate: input.toDate,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid request");
      }

      const { error } = await supabase.from("change_requests").insert({
        client_id: input.clientId,
        coach_id: input.coachId,
        from_date: input.fromDate,
        to_date: input.toDate,
        workout_id: input.workoutId,
      });

      if (error) {
        if (error.code === "23505") {
          throw new DuplicatePendingRequestError();
        }
        throw error;
      }
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.changeRequest(clientId) });
    },
  });
}
