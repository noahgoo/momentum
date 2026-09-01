import { useEffect, useRef } from "react";
import { REALTIME_LISTEN_TYPES, type RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "../supabase";

type PostgresChangeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

interface UseRealtimeSubscriptionOptions<T extends Record<string, unknown>> {
  /** Table name — must be one of the tables added to the `supabase_realtime`
   * publication (messages, threads, workout_logs, goal_logs,
   * client_summaries as of Wave 2's 0008 migration). Subscribing to any
   * other table silently receives no events. */
  table: string;
  /** Postgres row filter, e.g. `client_id=eq.${clientId}`. Omit to receive
   * every change on the table that RLS lets this connection see. */
  filter?: string;
  event?: PostgresChangeEvent;
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void;
  /** Set false to skip subscribing (e.g. while a required id is not yet known). */
  enabled?: boolean;
}

/**
 * Wraps a single Supabase Realtime `postgres_changes` subscription behind a
 * hook: one channel per call, torn down on unmount, and re-subscribed
 * whenever `table`/`filter`/`event`/`enabled` change (a channel's filter
 * can't be mutated in place — supabase-js requires a fresh channel).
 *
 * RLS applies to realtime payloads exactly as it does to normal reads: a
 * client only receives INSERT/UPDATE/DELETE events for rows its own
 * policies would let it SELECT. There is no separate realtime ACL — do not
 * add client-side filtering as a security measure, `filter` is a
 * convenience for reducing traffic, not an access boundary.
 *
 * Each subscription gets its own channel (named from table+filter+event) —
 * channels are cheap and this keeps failure/reconnect of one subscription
 * from affecting unrelated ones.
 */
export function useRealtimeSubscription<T extends Record<string, unknown>>({
  table,
  filter,
  event = "*",
  onChange,
  enabled = true,
}: UseRealtimeSubscriptionOptions<T>): void {
  // onChange is intentionally not a dependency — callers pass fresh
  // closures each render. We keep the latest one in a ref and read it from
  // inside the (stable) channel callback instead of re-subscribing on every
  // render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    const channelName = `${table}:${filter ?? "all"}:${event}`;
    const channel = supabase
      .channel(channelName)
      .on<T>(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        { event, schema: "public", table, filter },
        (payload) => {
          onChangeRef.current(payload);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // `onChange` is deliberately omitted from this dependency array — it's
    // read via `onChangeRef` above so a fresh closure per render doesn't
    // force a resubscribe.
  }, [table, filter, event, enabled]);
}
