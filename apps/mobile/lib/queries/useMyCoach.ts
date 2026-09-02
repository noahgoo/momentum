import { useQuery } from "@tanstack/react-query";
import type { Profile } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

/**
 * The signed-in client's own coach profile row, for display (name, in the
 * messages header). Allowed by RLS policy `profiles_select_own_coach`
 * (`id = (select invited_by from profiles where id = auth.uid())`).
 */
export function useMyCoach(coachId: string | null | undefined) {
  return useQuery<Profile | null>({
    queryKey: qk.myCoach(coachId ?? ""),
    enabled: Boolean(coachId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", coachId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
