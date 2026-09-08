import { useState } from "react";
import { useClientSummaries } from "../queries/useClientSummaries";

/**
 * Sends a one-off push message to a hand-picked set of clients. Lives in the
 * Inbox because it is outbound client messaging; how the *automatic* workout
 * reminders are scheduled is a configuration question and lives in Settings.
 */
export function BroadcastPage() {
  const { data: clients, isLoading } = useClientSummaries();
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  const handleClientToggle = (clientId: string) => {
    const newSelected = new Set(selectedClientIds);
    if (newSelected.has(clientId)) {
      newSelected.delete(clientId);
    } else {
      newSelected.add(clientId);
    }
    setSelectedClientIds(newSelected);
  };

  const handleSelectAll = () => {
    if (!clients) return;
    if (selectedClientIds.size === clients.length) {
      setSelectedClientIds(new Set());
    } else {
      setSelectedClientIds(new Set(clients.map((c) => c.client_id)));
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="admin-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">Compose message</h2>

        <div className="space-y-4">
          {/* Client Selection */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-50)]">
                Send to
              </label>
              {clients && clients.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-xs text-[var(--blue)] underline hover:text-[var(--blue-deep)]"
                >
                  {selectedClientIds.size === clients.length ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>

            <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--ink-08)] bg-white p-3">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-5 animate-pulse rounded bg-[var(--ink-08)]" />
                  ))}
                </div>
              ) : clients && clients.length > 0 ? (
                <div className="space-y-2">
                  {clients.map((client) => (
                    <label
                      key={client.client_id}
                      className="flex items-center gap-3 rounded px-2 py-2 hover:bg-[var(--cream)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedClientIds.has(client.client_id)}
                        onChange={() => handleClientToggle(client.client_id)}
                        className="h-4 w-4 rounded border-[var(--ink-30)] accent-[var(--blue)]"
                      />
                      <span className="text-sm text-[var(--ink)]">{client.display_name || "Unnamed Client"}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--ink-50)]">No clients available.</p>
              )}
            </div>
          </div>

          {/* Message Field */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-50)]">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What do you want to tell them?"
              className="mt-2 w-full rounded-lg border border-[var(--ink-08)] bg-white px-4 py-3 text-sm text-[var(--ink)] placeholder-[var(--ink-30)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              rows={4}
            />
          </div>

          {/* Send Button (Disabled) */}
          <div className="space-y-2">
            <button
              type="button"
              disabled
              className="w-full rounded-lg bg-[var(--ink-08)] px-4 py-2 text-sm font-semibold text-[var(--ink-30)] transition disabled:cursor-not-allowed"
            >
              Send message
            </button>
            <p className="text-xs text-[var(--warn)]">
              Push delivery ships post-MVP — reminders currently queue server-side only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
