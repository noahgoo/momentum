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
 *   ['goals', uid, 'logs', 'range', fromDateStr, toDateStr]
 *   ['messages', clientId]
 *   ['workoutWeek', uid, weekNumber]
 *   ['workoutDay', uid, dateStr]
 *   ['workoutHistory', uid]
 *   ['changeRequest', uid]
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
  /** Nested under `goals(uid)` too — a range covering `dateStr` includes it,
   * so invalidating `goals(uid)` invalidates both single-date and range keys. */
  goalLogsRange: (uid: string, fromDateStr: string, toDateStr: string) =>
    ["goals", uid, "logs", "range", fromDateStr, toDateStr] as const,
  messages: (clientId: string) => ["messages", clientId] as const,
  /** One week's 7-day grid (workout tab index.tsx). weekNumber is 1-based. */
  workoutWeek: (uid: string, weekNumber: number) => ["workoutWeek", uid, weekNumber] as const,
  /** Single date's workout/warmup/log/previous-log bundle ([date].tsx). */
  workoutDay: (uid: string, dateStr: string) => ["workoutDay", uid, dateStr] as const,
  /** Completed workout_logs, most recent first (history.tsx). */
  workoutHistory: (uid: string) => ["workoutHistory", uid] as const,
  /** This client's pending change_requests row, if any (MoveWorkoutCard). */
  changeRequest: (uid: string) => ["changeRequest", uid] as const,
};
