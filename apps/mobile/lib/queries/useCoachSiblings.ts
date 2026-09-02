import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface CoachSibling {
  id: string;
  display_name: string;
}

/**
 * Same-coach, non-disabled clients (excluding self) via the
 * `list_coach_siblings()` SECURITY DEFINER RPC (0018_list_coach_siblings.sql).
 * `profiles` RLS only grants a client SELECT on their own row and their
 * coach's row — not sibling clients — so this roster can't be read with a
 * plain `.from("profiles")` query; the RPC exists specifically to expose the
 * minimal `{id, display_name}` shape needed for the "find friends" picker
 * without widening that policy. See FindFriendsSection.tsx for the caller.
 */
export function useCoachSiblings(uid: string | undefined) {
  return useQuery<CoachSibling[]>({
    queryKey: qk.coachSiblings(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_coach_siblings");
      if (error) throw error;
      return data ?? [];
    },
  });
}
