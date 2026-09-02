import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Friendship } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface RemoveFriendshipInput {
  pairId: string;
  clientId: string;
}

/**
 * Deletes a friendship row — covers three UI actions that are all the same
 * write (plan 8.6 #2/#3): declining an incoming request, cancelling an
 * outgoing request, and unfriending an accepted pair. RLS
 * (`friendships_delete_members`) allows either member to delete regardless
 * of status, so no status branching is needed here.
 */
export function useRemoveFriendship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ pairId }: RemoveFriendshipInput) => {
      const { error } = await supabase.from("friendships").delete().eq("pair_id", pairId);
      if (error) throw error;
    },

    onMutate: async ({ pairId, clientId }) => {
      const key = qk.friendships(clientId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<Friendship[]>(key);
      queryClient.setQueryData<Friendship[]>(key, (current = []) =>
        current.filter((f) => f.pair_id !== pairId)
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
