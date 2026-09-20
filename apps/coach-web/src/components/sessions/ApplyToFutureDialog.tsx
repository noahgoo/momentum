import { useState } from "react";
import {
  describeApplyError,
  useApplySessionToFuture,
  type ApplyResult,
} from "../../queries/useSessionDetail";

interface Props {
  sessionId: string;
  onClose: () => void;
}

/**
 * Confirms pushing one day's contents onto the client's later days.
 *
 * Reports what actually happened rather than claiming success: the RPC
 * returns how many days it changed and how many it left alone, and the two
 * reasons it skips are the two a coach would otherwise have to trust
 * invisibly — a day the client has already reached, and a day they have
 * already logged.
 *
 * Needs connectivity. Its meaning depends on current server state, so it must
 * not queue offline (S3) — the mutation is `networkMode: "online"`, and this
 * says so plainly rather than appearing to succeed.
 */
export function ApplyToFutureDialog({ sessionId, onClose }: Props) {
  const apply = useApplySessionToFuture();
  const [includeWarmup, setIncludeWarmup] = useState(true);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      setResult(await apply.mutateAsync({ sessionId, includeWarmup }));
    } catch (err) {
      setError(describeApplyError(err));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Apply to later weeks"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        {result ? (
          <>
            <h2 className="text-base font-semibold text-[var(--ink)]">
              {result.applied === 0
                ? "No later days were changed"
                : result.applied === 1
                  ? "1 later day updated"
                  : `${result.applied} later days updated`}
            </h2>
            <ul className="mt-3 space-y-1 text-sm text-[var(--ink-50)]">
              {result.skipped_past > 0 && (
                <li>
                  {result.skipped_past === 1
                    ? "1 day was left alone because it has already passed."
                    : `${result.skipped_past} days were left alone because they have already passed.`}
                </li>
              )}
              {result.skipped_logged > 0 && (
                <li>
                  {result.skipped_logged === 1
                    ? "1 day was left alone because the client already logged it."
                    : `${result.skipped_logged} days were left alone because the client already logged them.`}
                </li>
              )}
              {result.applied === 0 &&
                result.skipped_past === 0 &&
                result.skipped_logged === 0 && (
                  <li>There are no later days built from the same workout.</li>
                )}
            </ul>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className="admin-primary px-4 py-2 text-sm">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-[var(--ink)]">Apply to later weeks</h2>
            <p className="mt-2 text-sm text-[var(--ink-50)]">
              This copies this day onto the client's later days that were built from the same
              workout. Days they have already reached or already logged are left alone.
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm text-[var(--ink-70)]">
              <input
                type="checkbox"
                checked={includeWarmup}
                onChange={(e) => setIncludeWarmup(e.target.checked)}
              />
              Include the warm-up
            </label>
            {error && <p className="mt-3 text-sm font-medium text-[var(--bad)]">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="admin-secondary px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={apply.isPending}
                className="admin-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {apply.isPending ? "Applying…" : "Apply"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
