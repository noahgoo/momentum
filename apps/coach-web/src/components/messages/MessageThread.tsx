import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Message } from "@momentum/shared";
import { dayKey, formatDaySeparator, formatTime } from "./timeFormat";

interface MessageThreadProps {
  clientName: string;
  messages: Message[];
  isPending: boolean;
  coachId: string;
  hasMoreEarlier: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  onSend: (text: string) => void;
  sending: boolean;
  sendError: boolean;
}

/**
 * Right pane of the coach inbox (Wave 9.6, scope #2): oldest-first bubbles
 * grouped under day separators, own messages (coach) in blue-deep on the
 * right per the scope's spec, an Enter-to-send / Shift+Enter-newline
 * textarea, and a "load earlier" affordance at the top of the scroll region.
 *
 * Autoscroll to bottom on new messages, but only when the viewer is already
 * near the bottom — avoids yanking the scroll position out from under a
 * coach who just paged in older history via `onLoadEarlier`.
 */
export function MessageThread({
  clientName,
  messages,
  isPending,
  coachId,
  hasMoreEarlier,
  loadingEarlier,
  onLoadEarlier,
  onSend,
  sending,
  sendError,
}: MessageThreadProps) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !wasNearBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    wasNearBottom.current = true;
    onSend(trimmed);
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  let lastDayKey: string | null = null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--ink-08)] px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--blue)] font-display text-sm text-[var(--ink)]">
          {(clientName[0] ?? "?").toUpperCase()}
        </div>
        <span className="font-display text-lg text-[var(--ink)]">{clientName}</span>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-4">
        <div className="flex min-h-full flex-col justify-end">
          {hasMoreEarlier && (
            <div className="mb-3 flex justify-center">
              <button
                type="button"
                onClick={onLoadEarlier}
                disabled={loadingEarlier}
                className="rounded-full border border-[var(--ink-08)] px-3 py-1 text-xs text-[var(--ink-50)] hover:bg-[var(--paper)] disabled:opacity-50"
              >
                {loadingEarlier ? "Loading…" : "Load earlier messages"}
              </button>
            </div>
          )}

          {isPending ? (
            <div className="flex flex-col gap-2.5">
              {[60, 75, 45, 80].map((w, i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-2xl bg-[var(--cream-deep)]"
                  style={{ width: `${w}%`, alignSelf: i % 2 === 0 ? "flex-start" : "flex-end" }}
                />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="pt-16 text-center text-sm text-[var(--ink-30)]">
              No messages in this thread yet
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {messages.map((msg, i) => {
                const isSent = msg.sender_id === coachId;
                const prevSame = i > 0 && messages[i - 1]?.sender_id === msg.sender_id;
                const key = dayKey(msg.sent_at);
                const showSeparator = key !== lastDayKey;
                lastDayKey = key;

                return (
                  <div key={msg.id}>
                    {showSeparator && (
                      <div className="my-4 flex items-center justify-center">
                        <span className="rounded-full bg-[var(--paper)] px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--ink-30)]">
                          {formatDaySeparator(msg.sent_at)}
                        </span>
                      </div>
                    )}
                    <div
                      className="flex flex-col"
                      style={{
                        alignItems: isSent ? "flex-end" : "flex-start",
                        marginTop: prevSame ? 2 : 12,
                      }}
                    >
                      <div
                        className={`max-w-[70%] whitespace-pre-wrap break-words px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                          isSent
                            ? "rounded-[18px_18px_4px_18px] bg-[var(--blue-deep)] text-white"
                            : "rounded-[18px_18px_18px_4px] border border-[var(--ink-08)] bg-white text-[var(--ink)]"
                        }`}
                      >
                        {msg.text}
                      </div>
                      <span
                        className={`mt-1 text-[10px] text-[var(--ink-30)] ${isSent ? "pr-1" : "pl-1"}`}
                      >
                        {formatTime(msg.sent_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {sendError && (
        <div className="shrink-0 border-t border-[var(--ink-08)] bg-white px-6 py-2 text-xs text-[var(--bad)]">
          Message didn&apos;t send. Try again.
        </div>
      )}

      <div className="flex shrink-0 items-end gap-3 border-t border-[var(--ink-08)] bg-white px-6 py-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${clientName.split(" ")[0] ?? "client"}…`}
          rows={1}
          className="max-h-32 flex-1 resize-none rounded-2xl border border-[var(--ink-08)] bg-[var(--cream)] px-4 py-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--blue-deep)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || sending}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg transition-colors ${
            text.trim() ? "bg-[var(--blue-deep)] text-white" : "bg-[var(--ink-08)] text-[var(--ink-30)]"
          }`}
          aria-label="Send message"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
