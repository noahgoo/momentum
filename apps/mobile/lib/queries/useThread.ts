import { useQuery } from "@tanstack/react-query";
import type { Thread } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { LIVE_CACHE } from "./cachePolicy";

/**
 * The client's own messaging thread row. `threads.client_id` is unique
 * (one thread per client-coach pair, plan finding #7), so this is a
 * `maybeSingle` lookup — a client who has never messaged their coach has no
 * thread row yet (created lazily on first send by `useSendMessage`, per the
 * client INSERT policy `threads_client_insert`).
 */
export function useThread(clientId: string | undefined) {
  return useQuery<Thread | null>({
    ...LIVE_CACHE,
    queryKey: qk.thread(clientId ?? ""),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threads")
        .select("*")
        .eq("client_id", clientId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
