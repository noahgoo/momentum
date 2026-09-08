import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";
import { useRealtimeSubscription } from "./useRealtime";

/** A thread row plus the client's display name, for the inbox's left pane. */
export interface ThreadWithClient extends Thread {
  client_display_name: string | null;
}

/**
 * Coach inbox thread list (Wave 9.6). Selects every `threads` row this coach
 * can see — RLS's `threads_coach_select` policy already scopes that to
 * `coach_id = auth.uid()`, so (per the queries README) there is no
 * client-side coach filter here.
 *
 * Ordered `last_message_at desc` (nulls-last via Postgres default) so an
 * un-messaged thread (created lazily, never sent into) sinks to the bottom
 * rather than the top.
 *
 * The client's name comes from an embedded `profiles` select via the
 * `threads_client_id_fkey` relationship rather than `client_summaries` —
 * `client_summaries` carries `unread_for_coach`/`last_message_at` but not the
 * message preview text (`threads.last_message`), so this reads `threads`
 * directly as the single source for the whole row instead of joining two
 * independently-realtime-updating tables.
 *
 * This is the query on its own, with no realtime subscription attached —
 * for read-only consumers like the sidebar's inbox badge, which want the
 * same cached rows the inbox is already keeping live but must not open a
 * second channel of their own. Use `useThreads` to also keep them live.
 */
export function useThreadsQuery() {
  return useQuery<ThreadWithClient[]>({
    queryKey: qk.threads(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threads")
        .select("*, profiles!threads_client_id_fkey(display_name)")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map(({ profiles, ...thread }) => ({
        ...thread,
        client_display_name: (profiles as { display_name: string | null } | null)?.display_name ?? null,
      }));
    },
  });
}

/**
 * The thread list plus the realtime subscription that keeps it live.
 *
 * Subscribes to `threads` (in the realtime publication) and patches the
 * cache in place — upsert-by-id on INSERT/UPDATE, remove-by-id on DELETE —
 * per the README's live-dashboard pattern, then re-sorts by
 * `last_message_at desc`. The realtime payload doesn't carry the joined
 * `client_display_name`, so an UPDATE event preserves whatever name is
 * already in the cache for that row (falls back to a refetch-free `null`
 * only if the thread is brand new — see the merge below).
 *
 * Exactly one mounted component should own this — the inbox — since every
 * mount adds its own channel; anything that only reads the rows uses
 * `useThreadsQuery`.
 */
export function useThreads() {
  const queryClient = useQueryClient();
  const query = useThreadsQuery();

  useRealtimeSubscription<Thread>({
    table: "threads",
    onChange: (payload) => {
      queryClient.setQueryData<ThreadWithClient[]>(qk.threads(), (current) => {
        if (!current) return current;

        if (payload.eventType === "DELETE") {
          const deletedId = payload.old.id;
          if (!deletedId) return current;
          return current.filter((row) => row.id !== deletedId);
        }

        const next = payload.new;
        const existing = current.find((row) => row.id === next.id);
        const withoutNext = current.filter((row) => row.id !== next.id);
        const merged: ThreadWithClient = {
          ...next,
          client_display_name: existing?.client_display_name ?? null,
        };
        return [...withoutNext, merged].sort((a, b) => {
          const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return bTime - aTime;
        });
      });
    },
  });

  return query;
}
