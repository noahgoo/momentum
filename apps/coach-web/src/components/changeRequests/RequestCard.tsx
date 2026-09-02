import type { ChangeRequestRow } from "../../queries/useChangeRequests";
import { formatDateWithWeekday, formatRelativeTime } from "./format";

interface PendingRequestCardProps {
  request: ChangeRequestRow;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting: boolean;
  isDeclining: boolean;
  errorMessage: string | null;
}

/** One pending change request: client/workout summary, from → to dates, Accept/Decline actions. */
export function PendingRequestCard({
  request,
  onAccept,
  onDecline,
  isAccepting,
  isDeclining,
  errorMessage,
}: PendingRequestCardProps) {
  const busy = isAccepting || isDeclining;

  return (
    <div className="admin-card p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--ink)]">{request.clientName ?? "Unknown client"}</p>
          <p className="text-xs text-[var(--ink-30)]">
            {request.workoutName ?? "Workout"} · requested {formatRelativeTime(request.requested_at)}
          </p>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="rounded-lg bg-[var(--ink-08)] px-2.5 py-1 font-medium text-[var(--ink-70)]">
          {formatDateWithWeekday(request.from_date)}
        </span>
        <span className="text-[var(--ink-30)]">→</span>
        <span className="rounded-lg bg-[var(--blue)]/20 px-2.5 py-1 font-medium text-[var(--ink)]">
          {formatDateWithWeekday(request.to_date)}
        </span>
      </div>

      {errorMessage && (
        <p className="mb-3 rounded-lg bg-[var(--bad)]/10 px-3 py-2 text-xs text-[var(--bad)]">{errorMessage}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="rounded-lg bg-[var(--blue-deep)] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {isAccepting ? "Accepting…" : "Accept"}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy}
          className="rounded-lg border border-[var(--ink-08)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-50)] transition hover:border-[var(--bad)] hover:text-[var(--bad)] disabled:opacity-40"
        >
          {isDeclining ? "Declining…" : "Decline"}
        </button>
      </div>
    </div>
  );
}

/** One resolved (accepted/rejected) change request row for the collapsed history section. */
export function HistoryRequestRow({ request }: { request: ChangeRequestRow }) {
  const isAccepted = request.status === "accepted";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--ink-08)] py-2.5 text-xs last:border-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[var(--ink-70)]">{request.clientName ?? "Unknown client"}</p>
        <p className="truncate text-[var(--ink-30)]">
          {request.workoutName ?? "Workout"} · {formatDateWithWeekday(request.from_date)} →{" "}
          {formatDateWithWeekday(request.to_date)}
        </p>
      </div>
      <div className="flex-none text-right">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            isAccepted ? "bg-[var(--ok)]/10 text-[var(--ok)]" : "bg-[var(--ink-08)] text-[var(--ink-50)]"
          }`}
        >
          {isAccepted ? "Accepted" : "Declined"}
        </span>
        <p className="mt-1 text-[var(--ink-15)]">{formatRelativeTime(request.responded_at)}</p>
      </div>
    </div>
  );
}
