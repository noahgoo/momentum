import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Friendship } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface AcceptFriendRequestInput {
  pairId: string;
  clientId: string;
}

/**
 * Accepts an incoming pending friend request. RLS (`friendships_client_update`)
 * enforces the actual rule — the caller must be a member and NOT the
 * requester, and the update must move status pending -> accepted — so a
 * stale/foreign pairId simply gets rejected by Postgres rather than needing
 * a client-side re-check here.
 *
 * `accepted_at` is set from the client (not a trigger) since there's no
 * server-side "on accept" timestamp trigger in this schema — see
 * 0013_change_requests_and_friendships.sql, which only triggers stats
 * recompute off the status transition, not the timestamp itself.
 */
export function useAcceptFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ pairId }: AcceptFriendRequestInput) => {
      const { error } = await supabase
        .from("friendships")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("pair_id", pairId);
      if (error) throw error;
    },

    onMutate: async ({ pairId, clientId }) => {
      const key = qk.friendships(clientId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<Friendship[]>(key);
      queryClient.setQueryData<Friendship[]>(key, (current = []) =>
        current.map((f) => (f.pair_id === pairId ? { ...f, status: "accepted" as const } : f))
      );

      return { previous, key };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.friendships(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
