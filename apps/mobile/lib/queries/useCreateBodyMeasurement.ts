import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bodyMeasurementCreateSchema, type BodyMeasurementCreate } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface CreateBodyMeasurementInput {
  clientId: string;
  entry: BodyMeasurementCreate;
}

/**
 * Inserts a new body_measurements row for `date` (device-local "today" by
 * default, per constraint #11). Measurements are immutable (constraint
 * #10) — there is deliberately no corresponding update hook; a correction
 * is delete + re-add. Validated against the shared zod schema at the app
 * boundary before hitting Postgres.
 */
export function useCreateBodyMeasurement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, entry }: CreateBodyMeasurementInput) => {
      const parsed = bodyMeasurementCreateSchema.parse(entry);
      const { error } = await supabase.from("body_measurements").insert({
        client_id: clientId,
        date: parsed.date,
        weight_lbs: parsed.weightLbs ?? null,
        neck_in: parsed.neckIn ?? null,
        waist_in: parsed.waistIn ?? null,
        hips_in: parsed.hipsIn ?? null,
        chest_in: parsed.chestIn ?? null,
        arm_in: parsed.armIn ?? null,
        thigh_in: parsed.thighIn ?? null,
      });
      if (error) throw error;
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.bodyMeasurements(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
