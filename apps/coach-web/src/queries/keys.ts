/**
 * Query-key factory for @tanstack/react-query. All hooks in this directory
 * must build their keys through `qk` — never inline a key array in a hook.
 * This keeps invalidation centralized and lets callers invalidate whole
 * subtrees with a prefix.
 *
 * Hierarchy:
 *   ['clientSummaries']
 *   ['clientSummaries', clientId]   <- clientDetail nests under the list
 *   ['clientSummaries', clientId, 'goals']            <- active + archived goals for the client detail page
 *   ['clientSummaries', clientId, 'progressPhotos']   <- signed-URL photo strip for the client detail page
 *   ['clientSummaries', clientId, 'activeAssignment']  <- current active assignment for the Assign page's "will be replaced" card
 *   ['threads']
 *   ['threads', threadId, 'messages']   <- messages for one thread, keyed by thread id (not client id —
 *                                          coach-web's inbox is thread-list-driven and a thread may not
 *                                          exist yet for a `?client=` preselection; see useThreadMessages)
 *   ['workouts']
 *   ['workouts', 'warmups']                       <- warmups list nests under workouts
 *   ['workouts', workoutId]                       <- workoutDetail nests under the list
 *   ['workouts', 'exerciseCounts', sortedIds[]]    <- list-card exercise counts
 *   ['exercises']
 *   ['exercises', 'usageCounts', sortedIds[]]     <- library-page count of workouts referencing each exercise
 *   ['programs']
 *   ['programs', programId]   <- programDetail nests under the list (9.4 builder edit mode)
 *   ['changeRequests']
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
  clientGoals: (id: string) => ["clientSummaries", id, "goals"] as const,
  clientProgressPhotos: (id: string) => ["clientSummaries", id, "progressPhotos"] as const,
  clientActiveAssignment: (id: string) => ["clientSummaries", id, "activeAssignment"] as const,
  threads: () => ["threads"] as const,
  threadMessages: (threadId: string) => ["threads", threadId, "messages"] as const,
  workouts: () => ["workouts"] as const,
  warmups: () => ["workouts", "warmups"] as const,
  workoutDetail: (id: string) => ["workouts", id] as const,
  workoutExerciseCounts: (workoutIds: string[]) =>
    ["workouts", "exerciseCounts", [...workoutIds].sort()] as const,
  exercises: () => ["exercises"] as const,
  exerciseUsageCounts: (exerciseIds: string[]) =>
    ["exercises", "usageCounts", [...exerciseIds].sort()] as const,
  programs: () => ["programs"] as const,
  programDetail: (id: string) => ["programs", id] as const,
  changeRequests: () => ["changeRequests"] as const,
  motivationEntries: () => ["motivationEntries"] as const,
};
