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
      // Get current coach's id
      const { data: sessionData } = await supabase.auth.getSession();
      const coachId = sessionData?.session?.user?.id;
      if (!coachId) throw new Error("Not authenticated");

      // Check if exists
      const { data: existing } = await supabase
        .from("motivation_entries")
        .select("*")
        .eq("week_start", weekStart)
        .eq("created_by", coachId)
        .maybeSingle();

      if (existing) {
        // Update
        const { data, error } = await supabase
          .from("motivation_entries")
          .update({ quote, image_url: imageUrl })
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) throw error;
        return data;
      } else {
        // Insert
        const { data, error } = await supabase
          .from("motivation_entries")
          .insert({
            quote,
            image_url: imageUrl,
            week_start: weekStart,
            created_by: coachId,
          })
          .select("*")
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.motivationEntries() });
    },
  });
}
