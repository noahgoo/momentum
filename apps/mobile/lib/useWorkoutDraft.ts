import { useDraft, type DraftState } from "./useDraft";

/**
 * The workout logger's slice of `useDraft` — same behaviour, with the key
 * built from what a workout draft belongs to.
 *
 * See docs/rules/offline-perf.md S1.
 */

const DRAFT_PREFIX = "workoutDraft";

function draftKey(clientId: string, date: string, workoutId: string): string {
  return `${DRAFT_PREFIX}:${clientId}:${date}:${workoutId}`;
}

export type WorkoutDraftState<T> = DraftState<T>;

export function useWorkoutDraft<T>(
  clientId: string | undefined,
  date: string | undefined,
  workoutId: string | undefined,
  /**
   * When the server's log was last written. A stored draft older than this
   * has already been superseded (e.g. saved from another device) and is
   * discarded rather than resurrecting stale values over fresher ones.
   */
  serverUpdatedAt?: string | null
): WorkoutDraftState<T> {
  const key = clientId && date && workoutId ? draftKey(clientId, date, workoutId) : null;
  return useDraft<T>(key, serverUpdatedAt);
}
