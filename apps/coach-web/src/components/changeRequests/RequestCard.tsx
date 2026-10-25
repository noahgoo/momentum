import type { ChangeRequestRow, MoveBatch } from "../../queries/useChangeRequests";
import { describeChangeRequestError } from "../../queries/useChangeRequests";
import { formatDateWithWeekday, formatRelativeTime } from "./format";

interface MoveBatchCardProps {
  batch: MoveBatch;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDecide: (ids: string[], decision: "accept" | "reject") => void;
  /** Which decision is in flight for this batch, if any. */
  busy: "accept" | "reject" | null;
  /** Outcome of the last decision on this batch, shown instead of assuming success. */
  notice: { tone: "ok" | "warn"; text: string } | null;
}

/**
 * One client's moves filed together. The coach can approve the whole batch,
 * or tick lines and decide only those. Dates are the client's own calendar
 * days (C1), which the card says rather than leaving the coach to assume.
 */
export function MoveBatchCard({ batch, selected, onToggle, onToggleAll, onDecide, busy, notice }: MoveBatchCardProps) {
  const ids = batch.moves.map((m) => m.id);
  const chosen = ids.filter((id) => selected.has(id));
  const allChosen = chosen.length === ids.length;
  const working = busy !== null;
  const single = ids.length === 1;

  return (
    <div className="admin-card p-4" data-testid="move-batch">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--ink)]">{batch.clientName ?? "Unknown client"}</p>
          <p className="text-xs text-[var(--ink-30)]">
            {single ? "1 workout" : `${ids.length} workouts`} · requested {formatRelativeTime(batch.requestedAt)} ·
            client&apos;s days
          </p>
        </div>
        {!single && (
          <label className="flex flex-none items-center gap-2 text-xs text-[var(--ink-50)]">
            <input type="checkbox" checked={allChosen} onChange={onToggleAll} disabled={working} />
            All
          </label>
        )}
      </div>

      <ul className="mb-3 space-y-2">
        {batch.moves.map((move) => (
          <li key={move.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!single && (
              <input
                type="checkbox"
                checked={selected.has(move.id)}
                onChange={() => onToggle(move.id)}
                disabled={working}
                aria-label={`Select ${move.workoutName ?? "workout"} on ${formatDateWithWeekday(move.from_date)}`}
              />
            )}
            <span className="text-xs font-medium text-[var(--ink-70)]">{move.workoutName ?? "Workout"}</span>
            <span className="flex items-center gap-2 text-sm">
              <span className="rounded-lg bg-[var(--ink-08)] px-2.5 py-1 font-medium text-[var(--ink-70)]">
                {formatDateWithWeekday(move.from_date)}
              </span>
              <span className="text-[var(--ink-30)]">→</span>
              <span className="rounded-lg bg-[var(--blue)]/20 px-2.5 py-1 font-medium text-[var(--ink)]">
                {formatDateWithWeekday(move.to_date)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {notice && (
        <p
          className={`mb-3 rounded-lg px-3 py-2 text-xs ${
            notice.tone === "ok" ? "bg-[var(--ok)]/10 text-[var(--ok)]" : "bg-[var(--bad)]/10 text-[var(--bad)]"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {single ? (
          <>
            <button
              type="button"
              onClick={() => onDecide(ids, "accept")}
              disabled={working}
              className="admin-primary px-3.5 py-1.5 text-xs disabled:opacity-40"
            >
              {busy === "accept" ? "Accepting…" : "Accept"}
            </button>
            <DeclineButton onClick={() => onDecide(ids, "reject")} disabled={working} busy={busy === "reject"} />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onDecide(ids, "accept")}
              disabled={working}
              className="admin-primary px-3.5 py-1.5 text-xs disabled:opacity-40"
            >
              {busy === "accept" && chosen.length === 0 ? "Approving…" : `Approve all (${ids.length})`}
            </button>
            <button
              type="button"
              onClick={() => onDecide(chosen, "accept")}
              disabled={working || chosen.length === 0}
              className="rounded-lg border border-[var(--ink-08)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-70)] transition hover:border-[var(--ink-30)] disabled:opacity-40"
            >
              Approve selected ({chosen.length})
            </button>
            <DeclineButton
              onClick={() => onDecide(chosen.length > 0 ? chosen : ids, "reject")}
              disabled={working}
              busy={busy === "reject"}
              label={chosen.length > 0 ? `Decline selected (${chosen.length})` : "Decline all"}
            />
          </>
        )}
      </div>
    </div>
  );
}

function DeclineButton({
  onClick,
  disabled,
  busy,
  label = "Decline",
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[var(--ink-08)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-50)] transition hover:border-[var(--bad)] hover:text-[var(--bad)] disabled:opacity-40"
    >
      {busy ? "Declining…" : label}
    </button>
  );
}

/** How a decided move reads in history, including who decided it (C8). */
function historyLabel(request: ChangeRequestRow): { text: string; good: boolean } {
  switch (request.status) {
    case "accepted":
      return { text: request.auto_applied ? "Auto-approved" : "Accepted", good: true };
    case "rejected":
      return { text: "Declined", good: false };
    case "cancelled":
      return { text: "Withdrawn", good: false };
    case "skipped":
      return {
        text: request.skip_reason ? `Not applied · ${describeChangeRequestError(request.skip_reason)}` : "Not applied",
        good: false,
      };
    default:
      return { text: request.status, good: false };
  }
}

/** One decided move row for the collapsed history section. */
export function HistoryRequestRow({ request }: { request: ChangeRequestRow }) {
  const { text, good } = historyLabel(request);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--ink-08)] py-2.5 text-xs last:border-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[var(--ink-70)]">{request.clientName ?? "Unknown client"}</p>
        <p className="truncate text-[var(--ink-30)]">
          {request.workoutName ?? "Workout"} · {formatDateWithWeekday(request.from_date)} →{" "}
          {formatDateWithWeekday(request.to_date)}
        </p>
      </div>
      <div className="max-w-[45%] flex-none text-right">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            good ? "bg-[var(--ok)]/10 text-[var(--ok)]" : "bg-[var(--ink-08)] text-[var(--ink-50)]"
          }`}
        >
          {text}
        </span>
        <p className="mt-1 text-[var(--ink-15)]">{formatRelativeTime(request.responded_at)}</p>
      </div>
    </div>
  );
}
