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
 *   ['programs']
 *
 * Keep every segment a plain string/primitive (no objects) so React Query's
 * default structural-sharing/equality checks stay cheap and predictable.
 */
export const qk = {
  clientSummaries: () => ["clientSummaries"] as const,
  clientDetail: (id: string) => ["clientSummaries", id] as const,
  threads: () => ["threads"] as const,
  workouts: () => ["workouts"] as const,
  programs: () => ["programs"] as const,
};
