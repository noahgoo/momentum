import { useQuery } from "@tanstack/react-query";
import { clientDateStr, clientToday } from "@momentum/shared";
import { supabase } from "./supabase";

/**
 * "Today" for a given CLIENT, in that client's timezone — not the coach's.
 *
 * A coach in New York opening a Los Angeles client at 1am Tuesday must see
 * that client's Monday, still open, because that is what the client sees.
 * Marking a workout missed because the *coach's* day rolled over is the bug
 * this exists to prevent. See docs/rules/concurrency.md C1.
 *
 * There is deliberately no ambient "today" on coach-web: a coach with
 * clients in several timezones has no single correct one, so every date is
 * resolved against the client it belongs to.
 *
 * RLS (`profiles_select_own_clients`) already scopes this to the coach's own
 * clients, so there is no coach_id filter here.
 */
export function useClientDate(clientId: string | undefined) {
  const { data: timezone } = useQuery<string | null>({
    queryKey: ["clientTimezone", clientId ?? ""],
    enabled: Boolean(clientId),
    // A timezone changes when someone travels, not minute to minute.
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", clientId as string)
        .maybeSingle();
      if (error) throw error;
      return data?.timezone ?? null;
    },
  });

  return {
    timezone: timezone ?? null,
    /** The client's current calendar date. Falls back to the default zone until loaded. */
    today: clientToday(timezone ?? null),
    /** The calendar date of an arbitrary instant, in the client's timezone. */
    toClientDate: (at: Date) => clientDateStr(timezone ?? null, at),
  };
}
