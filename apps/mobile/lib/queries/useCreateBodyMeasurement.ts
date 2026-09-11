import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bodyMeasurementCreateSchema, type BodyMeasurementCreate } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface CreateBodyMeasurementInput {
  clientId: string;
  entry: BodyMeasurementCreate;
}

/**
 * The insert itself, shared with the replay default registered in
 * mutationDefaults.ts — a queued mutation is persisted as key plus variables,
 * so the function has to exist independently of this hook.
 *
 * `body_measurements` is `unique (client_id, date)`, so a replayed insert of a
 * measurement that already landed raises 23505. That is the end state the
 * write wanted, so it counts as success rather than an error the client has to
 * see (C4). A same-day re-log is prevented in the UI instead: the measurements
 * screen knows whether today already has an entry and disables submit, so this
 * path only swallows genuine duplicates.
 */
export async function insertBodyMeasurement({ clientId, entry }: CreateBodyMeasurementInput) {
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
  if (error && error.code !== "23505") throw error;
}

/**
 * Inserts a new body_measurements row for `date` (device-local "today" by
 * default, per constraint #11). Measurements are immutable (constraint
 * #10) — there is deliberately no corresponding update hook; a correction
 * is delete + re-add. Validated against the shared zod schema at the app
 * boundary before hitting Postgres.
 *
 * Queued offline: a client logging in a basement has already stepped on the
 * scale, and the numbers are gone if the write does not survive a restart.
 */
export function useCreateBodyMeasurement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["createBodyMeasurement"],
    mutationFn: insertBodyMeasurement,

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.bodyMeasurements(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
