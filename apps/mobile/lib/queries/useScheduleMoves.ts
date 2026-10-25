import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  MovableDays,
  MovedDay,
  RequestScheduleMovesResult,
  ScheduleMovesRequest,
} from "@momentum/shared";
import { scheduleMovesRequestSchema } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { useRealtimeSubscription } from "./useRealtime";

/**
 * Every client-side key a schedule move can change (R6). A move rewrites what
 * two dates resolve to, so the week grid, both day screens, today's card and
 * the dashboard all go stale together; the coach-side counterpart is
 * `qk.changeRequests()` in apps/coach-web.
 */
function invalidateScheduleKeys(queryClient: QueryClient, uid: string) {
  void queryClient.invalidateQueries({ queryKey: qk.movableDays(uid) });
  void queryClient.invalidateQueries({ queryKey: qk.movedDays(uid) });
  void queryClient.invalidateQueries({ queryKey: qk.workoutWeek(uid) });
  void queryClient.invalidateQueries({ queryKey: qk.workoutDay(uid) });
  void queryClient.invalidateQueries({ queryKey: qk.todayWorkout(uid) });
  void queryClient.invalidateQueries({ queryKey: qk.dashboard(uid) });
  void queryClient.invalidateQueries({ queryKey: qk.changeRequestHistory(uid) });
}

/**
 * The reschedule screen's data in one round trip (S6): missed workouts still
 * movable, upcoming ones, the rest days a workout could land on, and this
 * client's pending moves. Resolved in SQL against the client's own today, so
 * nothing here re-derives the schedule from a device clock (C1, R5).
 *
 * Short staleTime: another device, or the coach deciding a move, changes it
 * without this client doing anything. The realtime subscription is what keeps
 * it fresh while a screen is open, so `staleTime` mainly governs refetch on
 * focus (S4).
 */
export function useMovableDays(uid: string | undefined) {
  const queryClient = useQueryClient();

  // A coach accepting or declining a move, or an auto-applied one landing from
  // another device, should show up without a pull-to-refresh.
  useRealtimeSubscription({
    table: "change_requests",
    filter: uid ? `client_id=eq.${uid}` : undefined,
    enabled: Boolean(uid),
    onChange: () => {
      if (uid) invalidateScheduleKeys(queryClient, uid);
    },
  });

  return useQuery<MovableDays>({
    queryKey: qk.movableDays(uid ?? ""),
    enabled: Boolean(uid),
    staleTime: 30_000,
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_movable_days");
      if (error) throw error;
      return data as unknown as MovableDays;
    },
  });
}

/**
 * Accepted moves touching a week, so a day that was moved away reads "Moved to
 * Oct 28" instead of an unexplained rest day. The name comes from the move's
 * own snapshot, never from the live session (R8).
 */
export function useMovedDays(uid: string | undefined, weekStart: string | undefined) {
  return useQuery<MovedDay[]>({
    queryKey: qk.movedDays(uid ?? "", weekStart),
    enabled: Boolean(uid) && Boolean(weekStart),
    staleTime: 60_000,
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_moved_days", {
        p_start_date: weekStart as string,
        p_days: 7,
      });
      if (error) throw error;
      return (data ?? []) as unknown as MovedDay[];
    },
  });
}

/**
 * Files many moves in one call. The batch id is minted by the caller and kept
 * across retries, so a double tap or a retried request is recognised
 * server-side and does nothing twice (C4).
 *
 * Deliberately not queued offline: the request's meaning depends on the
 * schedule as it is right now, and replaying it later could ask to move a
 * workout that has since moved. With `networkMode: "online"` the mutation
 * pauses while offline, and the screen says so rather than pretending it was
 * sent (S3).
 */
export function useRequestScheduleMoves(uid: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "online",
    mutationFn: async ({ batchId, moves }: { batchId: string; moves: ScheduleMovesRequest }) => {
      const parsed = scheduleMovesRequestSchema.safeParse(moves);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid request");
      }

      const { data, error } = await supabase.rpc("request_schedule_moves", {
        p_batch_id: batchId,
        p_moves: parsed.data.map((m) => ({ from_date: m.fromDate, to_date: m.toDate })),
      });
      // The RPC raises "<reason>: <date>"; callers pass the message through
      // describeScheduleMoveError.
      if (error) throw new Error(error.message);
      return data as unknown as RequestScheduleMovesResult;
    },
    onSettled: () => {
      if (uid) invalidateScheduleKeys(queryClient, uid);
    },
  });
}

/** Withdraws pending moves. Idempotent: a move already decided is simply not counted. */
export function useCancelScheduleMoves(uid: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "online",
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc("cancel_schedule_moves", { p_ids: ids });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSettled: () => {
      if (uid) invalidateScheduleKeys(queryClient, uid);
    },
  });
}
