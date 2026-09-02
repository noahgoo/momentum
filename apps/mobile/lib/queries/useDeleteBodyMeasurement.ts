import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BodyMeasurement } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface DeleteBodyMeasurementInput {
  clientId: string;
  entryId: string;
}

/**
 * Deletes one body_measurements entry. Measurements are immutable
 * (constraint #10) — this is the only way to correct a bad entry
 * (delete + re-add via useCreateBodyMeasurement), never an update.
 */
export function useDeleteBodyMeasurement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, entryId }: DeleteBodyMeasurementInput) => {
      const { error } = await supabase
        .from("body_measurements")
        .delete()
        .eq("id", entryId)
        .eq("client_id", clientId);
      if (error) throw error;
    },

    onMutate: async ({ clientId, entryId }) => {
      const key = qk.bodyMeasurements(clientId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<BodyMeasurement[]>(key);
      queryClient.setQueryData<BodyMeasurement[]>(key, (current = []) =>
        current.filter((entry) => entry.id !== entryId)
      );

      return { previous, key };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.bodyMeasurements(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
