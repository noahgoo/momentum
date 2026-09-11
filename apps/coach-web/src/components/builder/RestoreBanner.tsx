/**
 * Shown when a builder opened onto locally-restored work rather than the
 * server's copy. S1 requires the restore be visible rather than silent —
 * values appearing from nowhere are indistinguishable from a bug.
 *
 * Discard is the part the mobile logger's banner does not have: a coach who
 * abandoned a draft on purpose needs a way to say so, rather than having to
 * clear every field by hand or save work they did not want.
 */
export function RestoreBanner({
  onDiscard,
  onDismiss,
}: {
  onDiscard: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--ok-line)] bg-[var(--ok-bg)] px-4 py-2.5 text-sm text-[var(--ink-70)]"
    >
      <span className="flex-1">Restored your unsaved progress</span>
      <button
        type="button"
        onClick={onDiscard}
        className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--ink-70)] underline underline-offset-2 transition-colors hover:text-[var(--ink)]"
      >
        Discard
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-50)] transition-colors hover:bg-white/60 hover:text-[var(--ink)]"
      >
        ✕
      </button>
    </div>
  );
}
