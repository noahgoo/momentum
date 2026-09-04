import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MotivationEntry } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/** Get Monday date string of current week. */
function getWeekStart(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffToMonday = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(today.setDate(diffToMonday));
  return monday.toISOString().split("T")[0]!;
}

/** Get current week's motivation entry (if exists) and past 10 entries for history. */
export function useMotivationEntries() {
  return useQuery<{
    current: MotivationEntry | null;
    history: MotivationEntry[];
  }>({
    queryKey: qk.motivationEntries(),
    queryFn: async () => {
      const weekStart = getWeekStart();

      // Fetch current week's entry
      const { data: currentData, error: currentError } = await supabase
        .from("motivation_entries")
        .select("*")
        .eq("week_start", weekStart)
        .maybeSingle();

      if (currentError) throw currentError;

      // Fetch last 10 entries by created_at desc (excluding current week)
      const { data: historyData, error: historyError } = await supabase
        .from("motivation_entries")
        .select("*")
        .neq("week_start", weekStart)
        .order("created_at", { ascending: false })
        .limit(10);

      if (historyError) throw historyError;

      return {
        current: currentData ?? null,
        history: historyData ?? [],
      };
    },
  });
}

/** Insert or update this week's motivation entry. */
export function useUpsertMotivationEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      quote,
      imageUrl,
      weekStart,
    }: {
      quote: string;
      imageUrl: string | null;
      weekStart: string;
    }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const coachId = sessionData?.session?.user?.id;
      if (!coachId) throw new Error("Not authenticated");

      // One upsert against the (created_by, week_start) index rather than
      // select-then-branch: two sessions saving the same week both used to
      // see "no existing row" and both insert, leaving duplicates the read
      // path then chose between arbitrarily (C4). Also three round trips
      // down to one.
      const { data, error } = await supabase
        .from("motivation_entries")
        .upsert(
          {
            quote,
            image_url: imageUrl,
            week_start: weekStart,
            created_by: coachId,
          },
          { onConflict: "created_by,week_start" }
        )
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.motivationEntries() });
    },
  });
}
