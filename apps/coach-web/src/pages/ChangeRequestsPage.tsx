import { useMemo, useState } from "react";
import { HistoryRequestRow, MoveBatchCard } from "../components/changeRequests/RequestCard";
import {
  describeChangeRequestError,
  groupIntoBatches,
  useChangeRequests,
  useDecideScheduleMoves,
} from "../queries/useChangeRequests";

type Notice = { tone: "ok" | "warn"; text: string };

/** Says what a decision actually did, line by line, instead of claiming success. */
function summarize(
  decision: "accept" | "reject",
  result: { applied: number; rejected: number; skipped: { reason: string }[] }
): Notice {
  const done = decision === "accept" ? result.applied : result.rejected;
  const verb = decision === "accept" ? "Moved" : "Declined";
  const parts: string[] = [];
  if (done > 0) parts.push(`${verb} ${done} workout${done === 1 ? "" : "s"}.`);
  if (result.skipped.length > 0) {
    const reasons = [...new Set(result.skipped.map((s) => describeChangeRequestError(s.reason)))];
    parts.push(`${result.skipped.length} not applied: ${reasons.join(" ")}`);
  }
  return { tone: result.skipped.length > 0 ? "warn" : "ok", text: parts.join(" ") || "Nothing to do." };
}

export function ChangeRequestsPage() {
  const { data, isLoading } = useChangeRequests();
  const decide = useDecideScheduleMoves();

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<{ batchId: string; decision: "accept" | "reject" } | null>(null);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [banner, setBanner] = useState<Notice | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const batches = useMemo(() => groupIntoBatches(data?.pending ?? []), [data?.pending]);
  const history = data?.history ?? [];

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function handleDecide(batchId: string, ids: string[], decision: "accept" | "reject") {
    if (ids.length === 0) return;
    setBusy({ batchId, decision });
    setNotices((prev) => {
      const next = { ...prev };
      delete next[batchId];
      return next;
    });
    try {
      const result = await decide.mutateAsync({ ids, decision });
      // A fully decided batch leaves the list, taking its card (and any notice
      // on it) with it, so the outcome also goes in a banner that stays put.
      const outcome = summarize(decision, result);
      const clientName = batches.find((b) => b.batchId === batchId)?.clientName;
      setBanner({ tone: outcome.tone, text: clientName ? `${clientName}: ${outcome.text}` : outcome.text });
      if (outcome.tone === "warn") setNotices((prev) => ({ ...prev, [batchId]: outcome }));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } catch (error) {
      setNotices((prev) => ({ ...prev, [batchId]: { tone: "warn", text: describeChangeRequestError(error) } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <p className="mb-6 text-sm text-[var(--ink-50)]">
        Clients asking to move scheduled or missed workouts to a different day. Approve a whole request, or tick
        individual workouts. Clients set to auto-approve move on their own and show up here as history.
      </p>

      {banner && (
        <p
          role="status"
          className={`mb-4 rounded-lg px-3 py-2 text-xs ${
            banner.tone === "ok" ? "bg-[var(--ok)]/10 text-[var(--ok)]" : "bg-[var(--bad)]/10 text-[var(--bad)]"
          }`}
        >
          {banner.text}
        </p>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="admin-card h-28 animate-pulse p-4" />
          ))}
        </div>
      )}

      {!isLoading && batches.length === 0 && (
        <div className="admin-card border border-dashed border-[var(--ink-08)] py-16 text-center">
          <p className="text-sm text-[var(--ink-50)]">No pending requests.</p>
        </div>
      )}

      {!isLoading && batches.length > 0 && (
        <div className="space-y-3">
          {batches.map((batch) => (
            <MoveBatchCard
              key={batch.batchId}
              batch={batch}
              selected={selected}
              onToggle={toggle}
              onToggleAll={() => toggleAll(batch.moves.map((m) => m.id))}
              onDecide={(ids, decision) => void handleDecide(batch.batchId, ids, decision)}
              busy={busy?.batchId === batch.batchId ? busy.decision : null}
              notice={notices[batch.batchId] ?? null}
            />
          ))}
        </div>
      )}

      <div className="mt-8 border-t border-[var(--ink-08)] pt-4">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="text-xs font-semibold tracking-wider text-[var(--ink-30)] uppercase hover:text-[var(--ink-50)]"
        >
          History ({history.length}) {historyOpen ? "▾" : "▸"}
        </button>

        {historyOpen && (
          <div className="admin-card mt-3 p-4">
            {history.length === 0 ? (
              <p className="text-xs text-[var(--ink-30)]">No resolved requests yet.</p>
            ) : (
              history.map((request) => <HistoryRequestRow key={request.id} request={request} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
