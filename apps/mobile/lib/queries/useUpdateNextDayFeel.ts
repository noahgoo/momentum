import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addDaysStr } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import type { DashboardResult } from "./useDashboard";

interface UpdateNextDayFeelInput {
  /** The client's today (YYYY-MM-DD); yesterday is derived from it. */
  todayStr: string;
  clientId: string;
  /** 1 (Wrecked) – 5 (Great). */
  feel: 1 | 2 | 3 | 4 | 5;
}

/**
 * Patches `next_day_feel` onto YESTERDAY's workout_log row (the row is
 * guaranteed to already exist — the prompt only renders when yesterday's
 * log is `completed`, see useDashboard's `showFeelPrompt`). Follows the
 * README's three-part optimistic-mutation shape (see useToggleGoalLog.ts):
 * onMutate flips `showFeelPrompt` off immediately so the card disappears,
 * onError restores the snapshot, onSettled reconciles with the server.
 */
export function useUpdateNextDayFeel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, feel, todayStr }: UpdateNextDayFeelInput) => {
      // Yesterday in the CLIENT's calendar, not the device's.
      const yesterday = addDaysStr(todayStr, -1);
      const { error } = await supabase
        .from("workout_logs")
        .update({ next_day_feel: feel })
        .eq("client_id", clientId)
        .eq("date", yesterday);
      if (error) throw error;
    },

    onMutate: async ({ clientId }) => {
      const key = qk.dashboard(clientId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<DashboardResult>(key);
      queryClient.setQueryData<DashboardResult>(key, (current) =>
        current ? { ...current, showFeelPrompt: false } : current
      );

      return { previous, key };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
