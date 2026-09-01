/**
 * Query-key factory for @tanstack/react-query. All hooks in this directory
 * must build their keys through `qk` — never inline a key array in a hook.
 * This keeps invalidation centralized and lets callers invalidate whole
 * subtrees with a prefix (e.g. `qk.goals(uid)` invalidates every goal-log
 * key nested under it, since query-key matching is prefix-based).
 *
 * Hierarchy is deliberate:
 *   ['profile', uid]
 *   ['dashboard', uid]
 *   ['todayWorkout', uid]
 *   ['goals', uid]
 *   ['goals', uid, 'logs', dateStr]
 *   ['messages', clientId]
 *
 * Keep every segment a plain string/primitive (no objects) so React Query's
 * default structural-sharing/equality checks stay cheap and predictable.
 */
export const qk = {
  profile: (uid: string) => ["profile", uid] as const,
  dashboard: (uid: string) => ["dashboard", uid] as const,
  todayWorkout: (uid: string) => ["todayWorkout", uid] as const,
  goals: (uid: string) => ["goals", uid] as const,
  goalLogs: (uid: string, dateStr: string) => ["goals", uid, "logs", dateStr] as const,
  messages: (clientId: string) => ["messages", clientId] as const,
};
