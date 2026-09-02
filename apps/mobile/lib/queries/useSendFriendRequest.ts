import { useMutation, useQueryClient } from "@tanstack/react-query";
import { friendRequestCreateSchema } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface SendFriendRequestInput {
  /** The other client's profile id. Validated against `friendRequestCreateSchema`. */
  friendId: string;
  clientId: string;
}

/**
 * Sends a new friend request. Per RLS `friendships_client_insert`
 * (0009_advisor_hardening.sql), the insert only needs `client_id`,
 * `friend_id`, `requested_by`, and `status: 'pending'` — `pair_id`,
 * `coach_id`, and `member_names` are all overwritten by the
 * `friendships_before_insert` BEFORE INSERT trigger regardless of what's
 * sent, which also enforces the same-coach constraint server-side (raises
 * `friends_must_share_coach` if violated). We don't duplicate that check
 * client-side; a violation surfaces as a thrown PostgrestError the caller
 * can display.
 *
 * `pair_id`/`coach_id` are still required by the generated `Insert` type
 * (no DB-level default, since they're populated by trigger, not a column
 * default) — the placeholders below are discarded by the trigger before
 * the row is ever visible.
 *
 * NON-GOAL note (plan 8.6): the roster this mutation's `friendId` comes from
 * (a same-coach client picker) is not readable under current `profiles` RLS
 * — see the "Find friends" section in friends.tsx, which is disabled with an
 * explanatory empty state pending an RLS follow-up. This hook still exists
 * so it's ready to wire up the moment a roster becomes available (e.g. via
 * a future SECURITY DEFINER RPC), without another slice needing to touch
 * the mutation layer.
 */
export function useSendFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ friendId, clientId }: SendFriendRequestInput) => {
      const parsed = friendRequestCreateSchema.parse({ friendId });
      const { error } = await supabase.from("friendships").insert({
        client_id: clientId,
        friend_id: parsed.friendId,
        requested_by: clientId,
        status: "pending",
        // Overwritten by friendships_before_insert; required by the Insert type only.
        pair_id: `${clientId}_${parsed.friendId}`,
        coach_id: clientId,
      });
      if (error) throw error;
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.friendships(clientId) });
    },
  });
}
