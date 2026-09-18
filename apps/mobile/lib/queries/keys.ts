/**
 * Query-key factory for @tanstack/react-query. All hooks in this directory
 * must build their keys through `qk` — never inline a key array in a hook.
 * This keeps invalidation centralized and lets callers invalidate whole
 * subtrees with a prefix (e.g. `qk.goals(uid)` invalidates every goal-log
 * key nested under it, since query-key matching is prefix-based).
 *
 * Hierarchy is deliberate:
 *   ['profile', uid]
 *   ['dashboard', uid, dateStr]
 *   ['todayWorkout', uid, dateStr]
 *   ['goals', uid]
 *   ['goals', uid, 'logs', dateStr]
 *   ['goals', uid, 'logs', 'range', fromDateStr, toDateStr]
 *   ['messages', clientId]
 *   ['thread', clientId]
 *   ['myCoach', coachId]
 *   ['workoutWeek', uid, weekNumber]
 *   ['workoutDay', uid, dateStr]
 *   ['workoutHistory', uid]
 *   ['changeRequest', uid]
 *   ['changeRequestHistory', uid]
 *   ['friendships', uid]
 *   ['progressPhotos', uid]
 *   ['bodyMeasurements', uid]
 *   ['streak', uid]
 *   ['coachSiblings', uid]
 *
 * Keep every segment a plain string/primitive (no objects) so React Query's
 * default structural-sharing/equality checks stay cheap and predictable.
 */
export const qk = {
  profile: (uid: string) => ["profile", uid] as const,
  dashboard: (uid: string, date?: string) =>
    date === undefined ? (["dashboard", uid] as const) : (["dashboard", uid, date] as const),
  // Date-optional: qk.todayWorkout(uid) is a PREFIX that invalidates every
  // date, so mutations never need to know what "today" is for this client.
  todayWorkout: (uid: string, date?: string) =>
    date === undefined
      ? (["todayWorkout", uid] as const)
      : (["todayWorkout", uid, date] as const),
  goals: (uid: string) => ["goals", uid] as const,
  goalLogs: (uid: string, dateStr: string) => ["goals", uid, "logs", dateStr] as const,
  /** Nested under `goals(uid)`, so invalidating `goals(uid)` invalidates both
   * single-date and range keys. NOTE the one-way-ness: `goalLogs(uid, date)`
   * is NOT a prefix of this key (index 3 is the literal 'range'), so
   * invalidating a single date does NOT reach a range covering it. Mutations
   * touching goal logs must go through `goals(uid)` or write to both. */
  goalLogsRange: (uid: string, fromDateStr: string, toDateStr: string) =>
    ["goals", uid, "logs", "range", fromDateStr, toDateStr] as const,
  messages: (clientId: string) => ["messages", clientId] as const,
  /** The client's single messaging thread row (threads.client_id is unique). */
  thread: (clientId: string) => ["thread", clientId] as const,
  /** The client's own coach's `profiles` row (display_name for the messages header). */
  myCoach: (coachId: string) => ["myCoach", coachId] as const,
  /** One week's 7-day grid (workout tab index.tsx). weekNumber is 1-based. */
  workoutWeek: (uid: string, weekNumber?: number, date?: string) =>
    weekNumber === undefined
      ? (["workoutWeek", uid] as const)
      : (["workoutWeek", uid, weekNumber, date] as const),
  /** Single date's workout/warmup/log/previous-log bundle ([date].tsx). */
  workoutDay: (uid: string, dateStr: string) => ["workoutDay", uid, dateStr] as const,
  /** Completed workout_logs, most recent first (history.tsx). */
  workoutHistory: (uid: string) => ["workoutHistory", uid] as const,
  /** This client's pending change_requests row, if any (MoveWorkoutCard). */
  changeRequest: (uid: string) => ["changeRequest", uid] as const,
  /** This client's own change_requests, any status, most recent first (settings.tsx). */
  changeRequestHistory: (uid: string) => ["changeRequestHistory", uid] as const,
  /** All friendships (any status) this client is a member of (friends.tsx). */
  friendships: (uid: string) => ["friendships", uid] as const,
  /** This client's progress_photos, most recent first (progress/photos.tsx). */
  progressPhotos: (uid: string) => ["progressPhotos", uid] as const,
  /** This client's body_measurements, most recent first (progress/measurements.tsx). */
  bodyMeasurements: (uid: string) => ["bodyMeasurements", uid] as const,
  /** get_my_streak() RPC result, standalone (progress/index.tsx's hero — see useTodayWorkout for the composite version). */
  streak: (uid: string) => ["streak", uid] as const,
  /** list_coach_siblings() RPC result — same-coach, non-disabled clients excluding self (FindFriendsSection). */
  coachSiblings: (uid: string) => ["coachSiblings", uid] as const,
};
