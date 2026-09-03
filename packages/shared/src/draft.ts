/**
 * Rules for locally-persisted in-progress work (workout drafts).
 *
 * Lives here rather than in the app because it is pure decision logic that
 * governs whether a client's entered work survives — the kind of thing that
 * must be tested, and packages/shared is where the test runner is.
 *
 * See docs/rules/offline-perf.md S1.
 */

/**
 * Whether a stored draft should replace what the server already has.
 *
 * A draft is only worth restoring if it was written after the server's copy.
 * An older one has already been superseded — saved from another device, say —
 * and restoring it would resurrect stale values over fresher ones.
 */
export function shouldRestoreDraft(
  savedAt: number | undefined,
  serverUpdatedAt: string | null | undefined
): boolean {
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return false;
  // No server copy yet: the draft is the only record of this work.
  if (!serverUpdatedAt) return true;
  const serverTime = new Date(serverUpdatedAt).getTime();
  // An unparseable server timestamp must never cost the client their entry.
  if (Number.isNaN(serverTime)) return true;
  return savedAt > serverTime;
}
