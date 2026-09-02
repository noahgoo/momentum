import { useThread } from "./useThread";
import { useRealtimeSubscription } from "./useRealtime";
import { useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@momentum/shared";
import { qk } from "./keys";

/**
 * Whether this client has an unread message from their coach, for the
 * Messages tab badge in (tabs)/_layout.tsx. Backed by `useThread` (already
 * cached under `qk.thread(clientId)`, so this doesn't duplicate the fetch
 * screens make) plus a realtime subscription on `threads` filtered to this
 * client's row, so the badge appears/disappears live without polling —
 * `threads` is in the `supabase_realtime` publication (see useRealtime.ts).
 *
 * On UPDATE we patch the cached thread directly rather than invalidating,
 * since the payload already carries the full new row and a refetch would be
 * redundant network traffic for a value this cheap to read off the event.
 */
export function useHasUnreadMessages(clientId: string | undefined): boolean {
  const queryClient = useQueryClient();
  const { data: thread } = useThread(clientId);

  useRealtimeSubscription<Thread>({
    table: "threads",
    filter: clientId ? `client_id=eq.${clientId}` : undefined,
    event: "UPDATE",
    enabled: Boolean(clientId),
    onChange: (payload) => {
      if (!clientId) return;
      const next = payload.new as Thread;
      queryClient.setQueryData(qk.thread(clientId), next);
    },
  });

  return Boolean(thread?.unread_for_client);
}
