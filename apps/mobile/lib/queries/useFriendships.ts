import { useQuery } from "@tanstack/react-query";
import type { Friendship } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

/**
 * All friendship rows (any status) this client is a member of. RLS
 * (`friendships_select_members`) already scopes this to rows where the
 * caller is `client_id`, `friend_id`, or the shared `coach_id` — no
 * additional `.or()` filter is needed for security, but we still filter by
 * membership client-side so a coach-viewed row (if this hook were ever
 * reused coach-side) wouldn't slip through. On mobile the caller is always
 * a client, so every row returned is one they're a member of.
 *
 * No realtime subscription (plan 8.6 non-goal: "Realtime optional: skip") —
 * screens using this hook refetch on focus instead.
 */
export function useFriendships(uid: string | undefined) {
  return useQuery<Friendship[]>({
    queryKey: qk.friendships(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const clientId = uid as string;
      const { data, error } = await supabase
        .from("friendships")
        .select("*")
        .or(`client_id.eq.${clientId},friend_id.eq.${clientId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The other member's id + display name for a friendship, from this client's POV. */
export function otherMember(friendship: Friendship, myUid: string): { uid: string; name: string } {
  const otherId = friendship.client_id === myUid ? friendship.friend_id : friendship.client_id;
  const memberNames = (friendship.member_names ?? {}) as Record<string, string>;
  return { uid: otherId, name: memberNames[otherId] || "Friend" };
}
