/**
 * Cache lifetimes, as three named tiers rather than a number per query.
 *
 * Every query used to inherit one global `staleTime: 30_000`, so the exercise
 * library refetched as often as a live message thread (violation S-3). A
 * named tier is greppable, says why it was chosen, and gives one place to
 * tune — 18 hand-picked numbers would not.
 *
 * `gcTime` is deliberately long everywhere: the cache is persisted to disk
 * (see queryClient.ts), and a query evicted from memory is a query that
 * cannot paint a screen offline. See docs/rules/offline-perf.md S4/S5.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Rarely changes and is jarring to refetch constantly: the exercise library,
 * a workout's definition, a coach's profile.
 */
export const STATIC_CACHE = {
  staleTime: 10 * MINUTE,
  gcTime: 24 * HOUR,
} as const;

/**
 * The client's own data, which their own writes already update optimistically:
 * today's workout, goals, logs, measurements.
 */
export const OWNED_CACHE = {
  staleTime: 30_000,
  gcTime: 24 * HOUR,
} as const;

/**
 * Shared and realtime-driven, where the subscription keeps it fresh and
 * `staleTime` mainly governs refetch-on-focus: messages, unread counts,
 * friend activity.
 */
export const LIVE_CACHE = {
  staleTime: 0,
  gcTime: 6 * HOUR,
} as const;
