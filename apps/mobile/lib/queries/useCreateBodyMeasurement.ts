import { useMutation, useQueryClient } from "@tanstack/react-query";
import { bodyMeasurementCreateSchema, type BodyMeasurementCreate } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface CreateBodyMeasurementInput {
  clientId: string;
  entry: BodyMeasurementCreate;
}

/** Raised when today already has an entry. `body_measurements` is one row per client per day. */
export class DuplicateMeasurementError extends Error {
  constructor() {
    super("You've already logged measurements today.");
    this.name = "DuplicateMeasurementError";
  }
}

/**
 * The insert itself, shared with the replay default registered in
 * mutationDefaults.ts — a queued mutation is persisted as key plus variables,
 * so the function has to exist independently of this hook.
 *
 * `body_measurements` is `unique (client_id, date)`, so an insert for a date
 * that already has a row raises 23505. What that means depends entirely on who
 * is asking, which is why the caller has to say:
 *
 * - **A replay** (`onDuplicate: "succeed"`) is re-sending a write that already
 *   landed. The row it wanted exists, so this is success (C4).
 * - **A person pressing Save** (`onDuplicate: "throw"`, the default) is sending
 *   *different* numbers. Calling that success would report a save that never
 *   happened and let the caller clear the form and the draft — silently
 *   destroying what they just measured, which is exactly the failure S1 exists
 *   to prevent.
 *
 * Defaulting to "throw" matters: a future caller that forgets this argument
 * gets the safe behaviour rather than the data-destroying one.
 */
export async function insertBodyMeasurement(
  { clientId, entry }: CreateBodyMeasurementInput,
  { onDuplicate }: { onDuplicate: "succeed" | "throw" } = { onDuplicate: "throw" }
) {
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
  if (!error) return;
  if (error.code === "23505") {
    if (onDuplicate === "succeed") return;
    throw new DuplicateMeasurementError();
  }
  throw error;
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
    // Wrapped rather than passed directly: React Query hands the mutationFn a
    // context object as its second argument, which would otherwise land in the
    // options slot and decide the duplicate behaviour by accident.
    mutationFn: (input: CreateBodyMeasurementInput) =>
      insertBodyMeasurement(input, { onDuplicate: "throw" }),

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.bodyMeasurements(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
