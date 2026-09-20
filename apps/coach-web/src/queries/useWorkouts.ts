import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Workout, WorkoutType } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/**
 * Coach's workout (or warmup) library, filtered by `type`.
 *
 * With `clientId`, the list widens to that client's own shelf alongside the
 * global library — `client_id is null or client_id = :clientId`. That filter
 * carries DOMAIN meaning (whose shelf an entry sits on), not security, so it
 * belongs here and must stay: RLS already scopes these reads to this coach's
 * own rows, which is why there is no `created_by` filter.
 *
 * Without `clientId` the list is global-only, which is what the library page
 * shows.
 */
export function useWorkouts(type: WorkoutType, clientId?: string) {
  return useQuery<Workout[]>({
    queryKey: type === "warmup" ? qk.warmups(clientId) : qk.workouts(clientId),
    queryFn: async () => {
      let query = supabase.from("workouts").select("*").eq("type", type);
      query = clientId
        ? query.or(`client_id.is.null,client_id.eq.${clientId}`)
        : query.is("client_id", null);

      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The category values a coach has actually used, for the filter facets. */
export function deriveCategories(workouts: Workout[]): string[] {
  const seen = new Set<string>();
  for (const w of workouts) if (w.category) seen.add(w.category);
  return Array.from(seen).sort();
}

/** Per-workout exercise counts, keyed by workout id, for the list cards. */
export function useWorkoutExerciseCounts(workoutIds: string[]) {
  return useQuery<Record<string, number>>({
    queryKey: qk.workoutExerciseCounts(workoutIds),
    queryFn: async () => {
      if (workoutIds.length === 0) return {};
      const { data, error } = await supabase
        .from("workout_exercises")
        .select("workout_id")
        .in("workout_id", workoutIds);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.workout_id] = (counts[row.workout_id] ?? 0) + 1;
      }
      return counts;
    },
    enabled: workoutIds.length > 0,
  });
}

function invalidateListsFor(type: WorkoutType) {
  return type === "warmup" ? qk.warmups() : qk.workouts();
}

/**
 * How many scheduled sessions were built from this library workout.
 *
 * INFORMATIONAL, not a blocker. A session is a copy and records only where it
 * came from (`source_workout_id`, on delete set null), so deleting a library
 * entry leaves every scheduled day standing with its own exercises intact.
 * This exists so the confirm can say what the delete affects — the old
 * `workout_delete_blockers` refused the delete outright, which was right when
 * a schedule pointed at the workout and is wrong now.
 */
export async function fetchWorkoutUsageCount(workoutId: string): Promise<number> {
  const { data, error } = await supabase.rpc("workout_usage_count", {
    p_workout_id: workoutId,
  });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? 0;
}

/** Deletes a workout; its workout_exercises cascade. */
export function useDeleteWorkout(type: WorkoutType) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workoutId: string) => {
      const { error } = await supabase.from("workouts").delete().eq("id", workoutId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidateListsFor(type) });
    },
  });
}

/**
 * Duplicates a workout through the `duplicate_workout` RPC.
 *
 * This was four separate requests with no transaction — read the workout,
 * read its exercises, insert the copy, insert the children — so a dropped
 * connection could leave a workout with no exercises (R2, violation B15).
 * `clientId` files the copy under one client rather than the global library.
 */
export function useDuplicateWorkout(type: WorkoutType) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { workoutId: string; clientId?: string }) => {
      const { workoutId, clientId } =
        typeof input === "string" ? { workoutId: input, clientId: undefined } : input;
      const { data, error } = await supabase.rpc("duplicate_workout", {
        p_workout_id: workoutId,
        p_client_id: clientId ?? undefined,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidateListsFor(type) });
    },
  });
}
