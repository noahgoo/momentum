import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { LIVE_CACHE } from "./cachePolicy";
import { useRealtimeSubscription } from "./useRealtime";

const PAGE_SIZE = 50;

export interface UseMessagesResult {
  /** Oldest-first, ready to feed straight into an inverted FlatList's `data`
   * after reversing (screens invert display order, not this array). */
  messages: Message[];
  isPending: boolean;
  isError: boolean;
  /** True once a `loadEarlier` fetch returned fewer than PAGE_SIZE rows for
   * the range before the oldest loaded message — no more history to page in. */
  hasMoreEarlier: boolean;
  loadingEarlier: boolean;
  loadEarlier: () => Promise<void>;
}

/**
 * Messages for the client's own thread, latest 50 initially (finding #7's
 * page size), with a manual "load earlier" range query for older history —
 * this is intentionally NOT an infinite-query hook because the realtime
 * append path (below) needs a single flat cache array it can splice into
 * directly, and useInfiniteQuery's page-keyed shape would fight that.
 *
 * Realtime: subscribes to `messages` filtered to this thread's id (NOT the
 * client's uid — `messages.thread_id` is a FK to `threads.id`, so the
 * thread row must be resolved first) and appends/dedupes new rows into the
 * cache by id, per the queries README's "patch the cache directly" guidance.
 */
export function useMessages(clientId: string | undefined, threadId: string | null | undefined) {
  const queryClient = useQueryClient();
  const [hasMoreEarlier, setHasMoreEarlier] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const key = qk.messages(clientId ?? "");

  const query = useQuery<Message[]>({
    ...LIVE_CACHE,
    queryKey: key,
    enabled: Boolean(clientId && threadId),
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

  // Reset pagination state whenever the thread identity changes (new thread
  // just created, or switching accounts in dev).
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
    enabled: Boolean(clientId && threadId),
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
