import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { qk } from "./keys";

/**
 * Standalone `get_my_streak()` read for screens that only need the streak
 * number (progress/index.tsx's hero) without the rest of `useTodayWorkout`'s
 * composite fetch. Streak is never recomputed client-side (one canonical SQL
 * implementation, `compute_streak` — plan decision).
 */
export function useStreak(uid: string | undefined) {
  return useQuery<number>({
    queryKey: qk.streak(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_streak");
      if (error) throw error;
      return data ?? 0;
    },
  });
}
