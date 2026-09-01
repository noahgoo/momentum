import { useQuery } from "@tanstack/react-query";
import type { Profile } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

/**
 * Loads the signed-in user's own `profiles` row. `maybeSingle` (not
 * `single`) because a freshly-created auth user can momentarily have no
 * profile row yet (the `handle_new_user` trigger is async relative to the
 * client's first query) — we want `data: null`, not a thrown PostgrestError.
 */
export function useProfile(uid: string | undefined) {
  return useQuery<Profile | null>({
    queryKey: qk.profile(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", uid as string)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });
}
