import { describe, expect, it, vi } from "vitest";

// The hook module imports the Supabase client, which needs native storage and
// env; the arg builder under test is pure.
vi.mock("../supabase", () => ({ supabase: {} }));

import { buildSaveWorkoutLogArgs } from "./useSaveWorkoutLog";

describe("buildSaveWorkoutLogArgs", () => {
  const base = { date: "2026-09-14", sessionId: "s1", completed: false, clientId: "c1" };

  it("sends actual reps, weight with its unit, and the prescription snapshot", () => {
    const args = buildSaveWorkoutLogArgs({
      ...base,
      exercises: [
        {
          exerciseId: "e1",
          exerciseName: "Dumbbell Row",
          mode: "reps",
          sortOrder: 0,
          sets: [
            {
              setNumber: 1,
              completed: true,
              reps: 8,
              weight: 22.5,
              weightUnit: "kg",
              weightEntered: true,
              prescribed: { reps: 10, weight: 20, weightUnit: "kg", loadType: "each_hand", perSide: true },
            },
          ],
        },
      ],
    });
    const set = args.p_exercises[0].sets[0];
    expect(set).toMatchObject({ reps: 8, weight: 22.5, weight_unit: "kg", weight_entered: true });
    // P1/P6: the load type and unit travel inside the snapshot.
    expect(set.prescribed).toEqual({
      reps: 10,
      weight: 20,
      weight_unit: "kg",
      load_type: "each_hand",
      per_side: true,
    });
  });

  it("sends distance with its unit and never the old actual_miles key", () => {
    const args = buildSaveWorkoutLogArgs({
      ...base,
      exercises: [
        {
          exerciseId: "e2",
          exerciseName: "Run",
          mode: "distance",
          sortOrder: 0,
          sets: [{ setNumber: 1, completed: true, actualDistance: 5.2, distanceUnit: "km", actualSeconds: 1560 }],
        },
      ],
    });
    const set = args.p_exercises[0].sets[0];
    expect(set).toMatchObject({ actual_distance: 5.2, distance_unit: "km", actual_seconds: 1560 });
    expect(set).not.toHaveProperty("actual_miles");
  });

  it("keeps a genuine zero and sends null for what was not entered (P5)", () => {
    const args = buildSaveWorkoutLogArgs({
      ...base,
      exercises: [
        {
          exerciseId: "e1",
          exerciseName: "Pull-up",
          mode: "reps",
          sortOrder: 0,
          sets: [{ setNumber: 1, completed: true, reps: 0 }],
        },
      ],
    });
    const set = args.p_exercises[0].sets[0];
    expect(set.reps).toBe(0);
    expect(set.weight).toBeNull();
    expect(set.actual_distance).toBeNull();
    expect(set.distance_unit).toBeNull();
  });
});
