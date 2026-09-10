import { useState } from "react";
import { HistoryRequestRow, PendingRequestCard } from "../components/changeRequests/RequestCard";
import {
  describeChangeRequestError,
  useAcceptChangeRequest,
  useChangeRequests,
  useRejectChangeRequest,
} from "../queries/useChangeRequests";

// Stub owned by its feature slice — replace the body, not the route wiring.
export function ChangeRequestsPage() {
  const { data, isLoading } = useChangeRequests();
  const acceptRequest = useAcceptChangeRequest();
  const rejectRequest = useRejectChangeRequest();

  // Per-row in-flight id + error message, so one card's failed accept/decline
  // doesn't disable or mislabel every other row.
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [pendingActionKind, setPendingActionKind] = useState<"accept" | "decline" | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);

  const pending = data?.pending ?? [];
  const history = data?.history ?? [];

  async function handleAccept(requestId: string) {
    setPendingActionId(requestId);
    setPendingActionKind("accept");
    setRowErrors((prev) => ({ ...prev, [requestId]: "" }));
    try {
      await acceptRequest.mutateAsync(requestId);
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    } catch (error) {
      setRowErrors((prev) => ({ ...prev, [requestId]: describeChangeRequestError(error) }));
    } finally {
      setPendingActionId(null);
      setPendingActionKind(null);
    }
  }

  async function handleDecline(requestId: string) {
    setPendingActionId(requestId);
    setPendingActionKind("decline");
    setRowErrors((prev) => ({ ...prev, [requestId]: "" }));
    try {
      await rejectRequest.mutateAsync(requestId);
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    } catch (error) {
      setRowErrors((prev) => ({ ...prev, [requestId]: describeChangeRequestError(error) }));
    } finally {
      setPendingActionId(null);
      setPendingActionKind(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <p className="mb-6 text-sm text-[var(--ink-50)]">
        Clients asking to move a scheduled workout to a different day.
      </p>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="admin-card h-28 animate-pulse p-4" />
          ))}
        </div>
      )}

      {!isLoading && pending.length === 0 && (
        <div className="admin-card border border-dashed border-[var(--ink-08)] py-16 text-center">
          <p className="text-sm text-[var(--ink-50)]">No pending requests.</p>
        </div>
      )}

      {!isLoading && pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((request) => (
            <PendingRequestCard
              key={request.id}
              request={request}
              onAccept={() => handleAccept(request.id)}
              onDecline={() => handleDecline(request.id)}
              isAccepting={pendingActionId === request.id && pendingActionKind === "accept"}
              isDeclining={pendingActionId === request.id && pendingActionKind === "decline"}
              errorMessage={rowErrors[request.id] || null}
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
