import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { Thread } from "@momentum/shared";
import { MessageThread } from "../components/messages/MessageThread";
import { ThreadList } from "../components/messages/ThreadList";
import { useAuth } from "../lib/auth";
import { useClientSummaries } from "../queries/useClientSummaries";
import { useMarkThreadRead } from "../queries/useMarkThreadRead";
import { useSendMessage } from "../queries/useSendMessage";
import { useThreadMessages } from "../queries/useThreadMessages";
import { useThreads, type ThreadWithClient } from "../queries/useThreads";

/**
 * Coach inbox (Wave 9.6) — two-pane desktop layout per the slice scope:
 * a realtime thread list on the left, the selected thread's chat on the
 * right. Route is wired in App.tsx already; this file owns only the body.
 *
 * Below `lg` there is no room for two panes, so it becomes list-then-thread:
 * the list fills the screen until a thread is picked, then the chat does, with
 * a back arrow in the chat header. Which pane is showing (`mobilePane`) is
 * tracked separately from which thread is open (`selectedClientId`), and Back
 * only changes the former. That keeps MessageThread mounted across a
 * back-and-forth — it holds the composer draft in local state, so deselecting
 * the thread instead would silently discard a half-typed message
 * (offline-perf S1). At `lg` and up both panes are always visible and
 * `mobilePane` has no effect.
 *
 * `?client=<id>` preselection (from ClientHeaderCard's Message button, see
 * ClientDetailPage) may name a client with no thread row yet — the coach
 * INSERT policy allows creating one lazily on first send (assumption from
 * this slice's brief), so that case renders the chat pane with an empty
 * history and a working composer, backed by a `null` thread until send.
 */
export function MessagesPage() {
  const { profile } = useAuth();
  const coachId = profile?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const preselectClientId = searchParams.get("client");

  const { data: threads = [], isPending: threadsPending } = useThreads();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(preselectClientId);
  /** Which pane the phone layout is showing. Ignored at `lg` and up. */
  const [mobilePane, setMobilePane] = useState<"list" | "thread">(
    preselectClientId ? "thread" : "list"
  );

  // Only honor the query param once, on mount / when it changes — selecting
  // a different thread by hand shouldn't be overridden by a stale param.
  const consumedPreselect = useRef(false);
  useEffect(() => {
    if (preselectClientId && !consumedPreselect.current) {
      consumedPreselect.current = true;
      setSelectedClientId(preselectClientId);
      setMobilePane("thread");
    }
  }, [preselectClientId]);

  const selectedThread: ThreadWithClient | undefined = useMemo(
    () => threads.find((t) => t.client_id === selectedClientId),
    [threads, selectedClientId]
  );

  // Fallback name lookup for the `?client=` preselect case: that client may
  // have no thread row yet, so `selectedThread` (and its embedded
  // `client_display_name`) is undefined until the first send creates one.
  const { data: clientSummaries = [] } = useClientSummaries();
  const selectedClientName = useMemo(() => {
    if (selectedThread?.client_display_name) return selectedThread.client_display_name;
    return clientSummaries.find((c) => c.client_id === selectedClientId)?.display_name ?? null;
  }, [selectedThread, clientSummaries, selectedClientId]);

  const threadId = selectedThread?.id ?? null;
  const { messages, isPending, hasMoreEarlier, loadingEarlier, loadEarlier } = useThreadMessages(threadId);

  const sendMessage = useSendMessage();
  const markRead = useMarkThreadRead();
  const [sendError, setSendError] = useState(false);

  // Mark-read whenever a thread with unread coach-side messages is opened
  // (scope #3) — a lazily-not-yet-created thread has nothing to mark.
  // `markRead.mutate` is intentionally left out of the deps array: it's a
  // stable function identity from useMutation, and including the whole
  // `markRead` object would re-fire this effect on every mutation-state
  // render instead of only when the opened thread (or its unread flag)
  // changes.
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    if (!coachId || !threadId || !selectedThread?.unread_for_coach) return;
    markReadMutate({ coachId, threadId });
  }, [coachId, threadId, selectedThread?.unread_for_coach, markReadMutate]);

  function handleSelect(thread: ThreadWithClient) {
    setSelectedClientId(thread.client_id);
    setMobilePane("thread");
    setSendError(false);
    // Clear the query param once a selection has been made by hand so a
    // later back/forward nav doesn't re-force the original preselect.
    if (searchParams.has("client")) {
      const next = new URLSearchParams(searchParams);
      next.delete("client");
      setSearchParams(next, { replace: true });
    }
  }

  function handleSend(text: string) {
    if (!coachId || !selectedClientId) return;
    setSendError(false);
    sendMessage.mutate(
      {
        clientId: selectedClientId,
        coachId,
        thread: (selectedThread as Thread | undefined) ?? null,
        text,
      },
      { onError: () => setSendError(true) }
    );
  }

  if (!profile) {
    return (
      <div className="admin-card flex h-full items-center justify-center">
        <span className="text-sm text-[var(--ink-30)]">Loading…</span>
      </div>
    );
  }

  return (
    // `main` is a column flex container, so flex-1 + min-h-0 fills whatever is
    // left below the chrome at either breakpoint — no subtracting the header,
    // section nav and padding by hand.
    <div className="admin-card flex min-h-0 flex-1 overflow-hidden">
      <div
        className={`w-full shrink-0 flex-col border-r border-[var(--ink-08)] bg-[var(--paper)]/60 lg:flex lg:w-80 ${
          mobilePane === "list" ? "flex" : "hidden"
        }`}
      >
        <div className="shrink-0 border-b border-[var(--ink-08)] px-5 py-4">
          <h2 className="font-display text-lg text-[var(--ink)]">Conversations</h2>
          <p className="mt-1 text-[11px] tracking-wide text-[var(--ink-50)]">
            {threads.length} conversation{threads.length !== 1 ? "s" : ""}
          </p>
        </div>
        {threadsPending ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--ink-30)]">
            Loading…
          </div>
        ) : (
          <ThreadList threads={threads} selectedThreadId={threadId} onSelect={handleSelect} />
        )}
      </div>

      <div
        className={`min-w-0 flex-1 flex-col overflow-hidden lg:flex ${
          mobilePane === "thread" ? "flex" : "hidden"
        }`}
      >
        {!selectedClientId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--ink-08)] bg-[var(--cream)] font-display text-2xl text-[var(--ink-50)]">
              ✦
            </div>
            <h2 className="font-display text-2xl text-[var(--ink)]">Select a conversation</h2>
            <p className="max-w-xs text-sm text-[var(--ink-50)]">
              Choose a client from the left to view their messages
            </p>
          </div>
        ) : (
          <MessageThread
            clientName={selectedClientName ?? "Client"}
            onBack={() => setMobilePane("list")}
            messages={messages}
            isPending={isPending}
            coachId={coachId ?? ""}
            hasMoreEarlier={hasMoreEarlier}
            loadingEarlier={loadingEarlier}
            onLoadEarlier={() => void loadEarlier()}
            onSend={handleSend}
            sending={sendMessage.isPending}
            sendError={sendError}
          />
        )}
      </div>
    </div>
  );
}
