/**
 * Query-key factory for @tanstack/react-query. All hooks in this directory
 * must build their keys through `qk` — never inline a key array in a hook.
 * This keeps invalidation centralized and lets callers invalidate whole
 * subtrees with a prefix.
 *
 * Hierarchy:
 *   ['clientSummaries']
 *   ['clientSummaries', clientId]   <- clientDetail nests under the list
 *   ['threads']
 *   ['workouts']
 *   ['workouts', 'warmups']                       <- warmups list nests under workouts
 *   ['workouts', workoutId]                       <- workoutDetail nests under the list
 *   ['workouts', 'exerciseCounts', sortedIds[]]    <- list-card exercise counts
 *   ['exercises']
 *   ['programs']
 *
 * Keep every segment a plain string/primitive (no objects) so React Query's
 * default structural-sharing/equality checks stay cheap and predictable.
 * (`workoutExerciseCounts` is the one exception — its last segment is a
 * sorted array of ids, needed so the count query can key on "which workouts"
 * without a per-id nested key.)
 */
export const qk = {
  clientSummaries: () => ["clientSummaries"] as const,
  clientDetail: (id: string) => ["clientSummaries", id] as const,
  threads: () => ["threads"] as const,
  workouts: () => ["workouts"] as const,
  warmups: () => ["workouts", "warmups"] as const,
  workoutDetail: (id: string) => ["workouts", id] as const,
  workoutExerciseCounts: (workoutIds: string[]) =>
    ["workouts", "exerciseCounts", [...workoutIds].sort()] as const,
  exercises: () => ["exercises"] as const,
  programs: () => ["programs"] as const,
};
