import type { ThreadWithClient } from "../../queries/useThreads";
import { relativeTime } from "./timeFormat";

interface ThreadListProps {
  threads: ThreadWithClient[];
  selectedThreadId: string | null;
  onSelect: (thread: ThreadWithClient) => void;
}

/**
 * Left pane of the coach inbox (Wave 9.6, scope #1): client name, last
 * message preview, relative time, and an unread dot — ordered
 * `last_message_at desc` by the query itself (`useThreads`). Ported layout
 * from the old app's admin messages page, adapted to Tailwind classes per
 * coach-web's convention (admin sections use Tailwind, not inline styles).
 */
export function ThreadList({ threads, selectedThreadId, onSelect }: ThreadListProps) {
  if (threads.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-[var(--ink-30)]">No conversations yet</p>
      </div>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto">
      {threads.map((thread) => {
        const name = thread.client_display_name ?? "Client";
        const initial = (name[0] ?? "?").toUpperCase();
        const isSelected = thread.id === selectedThreadId;
        const isUnread = thread.unread_for_coach;

        return (
          <li key={thread.id} className="border-b border-[var(--ink-08)]">
            <button
              type="button"
              onClick={() => onSelect(thread)}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                isSelected ? "bg-[var(--blue)]/20" : "hover:bg-[var(--paper)]"
              }`}
            >
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-lg ${
                  isSelected ? "bg-[var(--blue-deep)] text-white" : "bg-[var(--blue)] text-[var(--ink)]"
                }`}
              >
                {initial}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--ink)]">{name}</span>
                  <span className="shrink-0 text-[10px] tracking-wide text-[var(--ink-30)]">
                    {relativeTime(thread.last_message_at)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span
                    className={`flex-1 truncate text-xs ${
                      isUnread ? "font-medium text-[var(--ink)]" : "text-[var(--ink-50)]"
                    }`}
                  >
                    {thread.last_message || "No messages yet"}
                  </span>
                  {isUnread && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--blue-deep)]" aria-label="Unread" />
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
