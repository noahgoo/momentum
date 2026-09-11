import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `body_measurements` is unique per client per day, so an insert for a date
 * that already has a row raises 23505 — and what that means depends entirely on
 * who is asking.
 *
 * A replay is re-sending a write that already landed, so the duplicate is the
 * end state it wanted. A person pressing Save is sending *different* numbers,
 * and calling that success reports a save that never happened, letting the
 * screen clear the form and the draft. That silently destroys what they just
 * measured — the exact failure offline-perf S1 exists to prevent, and it
 * shipped once already.
 *
 * `lib/supabase.ts` pulls in react-native and expo-secure-store, so it is
 * stubbed here rather than imported. That keeps this a behavioural test: it
 * calls the real function and checks what it does, instead of grepping the
 * source the way the mutation-key parity check has to.
 */

let nextError: { code?: string; message: string } | null = null;

vi.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      insert: async () => ({ error: nextError }),
    }),
  },
}));

const { insertBodyMeasurement, DuplicateMeasurementError } = await import(
  "./useCreateBodyMeasurement"
);

const input = {
  clientId: "client-1",
  entry: { date: "2026-09-11", weightLbs: 180 },
};

describe("insertBodyMeasurement", () => {
  beforeEach(() => {
    nextError = null;
  });

  it("resolves when the insert succeeds", async () => {
    await expect(insertBodyMeasurement(input)).resolves.toBeUndefined();
  });

  it("throws a typed duplicate error by default", async () => {
    // The default has to be the safe one: a caller that forgets the argument
    // must not get the behaviour that discards a person's entry.
    nextError = { code: "23505", message: "duplicate key value" };
    await expect(insertBodyMeasurement(input)).rejects.toBeInstanceOf(DuplicateMeasurementError);
  });

  it("throws the duplicate error for the interactive save", async () => {
    nextError = { code: "23505", message: "duplicate key value" };
    await expect(
      insertBodyMeasurement(input, { onDuplicate: "throw" })
    ).rejects.toBeInstanceOf(DuplicateMeasurementError);
  });

  it("treats a duplicate as success for an offline replay", async () => {
    nextError = { code: "23505", message: "duplicate key value" };
    await expect(
      insertBodyMeasurement(input, { onDuplicate: "succeed" })
    ).resolves.toBeUndefined();
  });

  it("still throws every other error, whatever the duplicate setting", async () => {
    nextError = { code: "08006", message: "connection failure" };
    await expect(
      insertBodyMeasurement(input, { onDuplicate: "succeed" })
    ).rejects.toMatchObject({ code: "08006" });
  });
});
