import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientSummary } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";
import { useRealtimeSubscription } from "./useRealtime";

/**
 * EXEMPLAR coach query — read this before writing any other coach-web hook.
 *
 * Selects every row in `client_summaries` ordered by display name. There is
 * no client-side `coach_id = ...` filter: RLS on `client_summaries` scopes
 * SELECT to `coach_id = auth.uid()` already (plan finding #8 / multi-coach
 * RLS design), so "all rows this query gets back" already means "my
 * clients." Do not add a redundant coach filter here or in any other
 * coach-web query — it would silently mask an RLS misconfiguration instead
 * of surfacing it.
 *
 * `client_summaries` is trigger-written only (plan finding #8) — it is
 * never written to by the app, only read.
 *
 * ── Live-dashboard pattern ────────────────────────────────────────────
 * This is the reference pattern for wiring realtime onto a list query:
 * subscribe to `postgres_changes` on the same table, and on each event
 * patch the react-query cache in place (INSERT/UPDATE upsert-by-key,
 * DELETE remove-by-key) rather than blindly invalidating and refetching.
 * A full refetch would also work but throws away the point of realtime
 * (instant, no round trip) for a table that changes constantly as clients
 * log workouts throughout the day.
 */
export function useClientSummaries() {
  const queryClient = useQueryClient();

  const query = useQuery<ClientSummary[]>({
    queryKey: qk.clientSummaries(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_summaries")
        .select("*")
        .order("display_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  useRealtimeSubscription<ClientSummary>({
    table: "client_summaries",
    onChange: (payload) => {
      queryClient.setQueryData<ClientSummary[]>(qk.clientSummaries(), (current) => {
        if (!current) return current;

        if (payload.eventType === "DELETE") {
          const deletedId = payload.old.client_id;
          if (!deletedId) return current;
          return current.filter((row) => row.client_id !== deletedId);
        }

        const next = payload.new;
        const withoutNext = current.filter((row) => row.client_id !== next.client_id);
        return [...withoutNext, next].sort((a, b) =>
          (a.display_name ?? "").localeCompare(b.display_name ?? "")
        );
      });
    },
  });

  return query;
}
