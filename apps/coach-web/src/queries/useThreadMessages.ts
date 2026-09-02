import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";
import { useRealtimeSubscription } from "./useRealtime";

const PAGE_SIZE = 50;

export interface UseThreadMessagesResult {
  /** Oldest-first. */
  messages: Message[];
  isPending: boolean;
  isError: boolean;
  hasMoreEarlier: boolean;
  loadingEarlier: boolean;
  loadEarlier: () => Promise<void>;
}

/**
 * Messages for one thread, latest 50 initially (plan finding #7's page
 * size), with a manual "load earlier" range query — mirrors
 * apps/mobile/lib/queries/useMessages.ts, but keyed by **thread id** rather
 * than client id: coach-web's left pane is a thread list, and per this
 * slice's ASSUMPTIONS a `?client=` preselection from the client detail page
 * may name a client with no thread row yet (lazy-created on first send).
 * `threadId` is `null` in exactly that case, and this hook just returns an
 * empty, disabled query — the chat pane still renders (composer included)
 * so the coach can send the first message.
 *
 * Not a `useInfiniteQuery` for the same reason as mobile's version: the
 * realtime append path needs one flat cache array to splice into directly.
 */
export function useThreadMessages(threadId: string | null | undefined) {
  const queryClient = useQueryClient();
  const [hasMoreEarlier, setHasMoreEarlier] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const key = qk.threadMessages(threadId ?? "");

  const query = useQuery<Message[]>({
    queryKey: key,
    enabled: Boolean(threadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", threadId as string)
        .order("sent_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      const oldestFirst = (data ?? []).slice().reverse();
      setHasMoreEarlier((data ?? []).length === PAGE_SIZE);
      return oldestFirst;
    },
  });

  // Reset pagination state whenever the thread identity changes (switching
  // threads, or a thread just got lazily created).
  useEffect(() => {
    setHasMoreEarlier(true);
  }, [threadId]);

  const loadEarlier = useCallback(async () => {
    if (!threadId || loadingEarlier || !hasMoreEarlier) return;
    const current = queryClient.getQueryData<Message[]>(key) ?? [];
    const oldest = current[0];
    if (!oldest) return;

    setLoadingEarlier(true);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", threadId)
        .lt("sent_at", oldest.sent_at)
        .order("sent_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;

      const older = (data ?? []).slice().reverse();
      setHasMoreEarlier((data ?? []).length === PAGE_SIZE);
      if (older.length > 0) {
        queryClient.setQueryData<Message[]>(key, (prev = []) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...older.filter((m) => !seen.has(m.id)), ...prev];
        });
      }
    } finally {
      setLoadingEarlier(false);
    }
  }, [threadId, loadingEarlier, hasMoreEarlier, queryClient, key]);

  useRealtimeSubscription<Message>({
    table: "messages",
    filter: threadId ? `thread_id=eq.${threadId}` : undefined,
    event: "INSERT",
    enabled: Boolean(threadId),
    onChange: (payload) => {
      const row = payload.new as Message;
      if (!row?.id) return;
      queryClient.setQueryData<Message[]>(key, (prev = []) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        return [...prev, row];
      });
    },
  });

  return {
    messages: query.data ?? [],
    isPending: query.isPending,
    isError: query.isError,
    hasMoreEarlier,
    loadingEarlier,
    loadEarlier,
  };
}
