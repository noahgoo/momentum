import { useState } from "react";
import {
  describeSaveAsWorkoutError,
  useSaveSessionAsWorkout,
} from "../../queries/useSessionDetail";
import { useClientSummaries } from "../../queries/useClientSummaries";

interface Props {
  sessionId: string;
  defaultName: string;
  /** The client this day belongs to, or null for a template program's day. */
  clientId: string | null;
  onClose: () => void;
}

/**
 * Files one scheduled day in the library as a reusable workout.
 *
 * Scope defaults to this client's own shelf rather than the global library:
 * a day that has been tailored for someone is usually tailored *to* them, and
 * a coach who wants it everywhere can say so. A client-scoped entry shows only
 * in that client's picker.
 *
 * The day itself is untouched — this copies out, never back.
 */
export function SaveAsWorkoutDialog({ sessionId, defaultName, clientId, onClose }: Props) {
  const saveAs = useSaveSessionAsWorkout();
  const { data: clients = [] } = useClientSummaries();
  const [name, setName] = useState(defaultName);
  const [scope, setScope] = useState<"client" | "global">(clientId ? "client" : "global");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const clientName = clients.find((c) => c.client_id === clientId)?.display_name ?? "this client";

  async function run() {
    setError(null);
    try {
      await saveAs.mutateAsync({
        sessionId,
        clientId: scope === "client" ? clientId : null,
        name: name.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(describeSaveAsWorkoutError(err));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save as workout"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        {done ? (
          <>
            <h2 className="text-base font-semibold text-[var(--ink)]">Saved to your library</h2>
            <p className="mt-2 text-sm text-[var(--ink-50)]">
              {scope === "client"
                ? `"${name}" will show up when you're building ${clientName}'s program.`
                : `"${name}" will show up for every client.`}
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className="admin-primary px-4 py-2 text-sm">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-[var(--ink)]">Save as workout</h2>
            <p className="mt-2 text-sm text-[var(--ink-50)]">
              Files this day in your library so you can pick it again. This day itself doesn't
              change.
            </p>

            <label className="mt-4 block text-xs font-medium text-[var(--ink-70)]">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
            />

            {clientId && (
              <fieldset className="mt-4">
                <legend className="text-xs font-medium text-[var(--ink-70)]">Show it for</legend>
                <label className="mt-2 flex items-center gap-2 text-sm text-[var(--ink-70)]">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === "client"}
                    onChange={() => setScope("client")}
                  />
                  {clientName} only
                </label>
                <label className="mt-1 flex items-center gap-2 text-sm text-[var(--ink-70)]">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === "global"}
                    onChange={() => setScope("global")}
                  />
                  Every client
                </label>
              </fieldset>
            )}

            {error && <p className="mt-3 text-sm font-medium text-[var(--bad)]">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="admin-secondary px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={saveAs.isPending || !name.trim()}
                className="admin-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {saveAs.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
