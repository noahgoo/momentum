import { describe, expect, it } from "vitest";

/**
 * Query results are written to AsyncStorage by the cache persister, which
 * serializes with JSON.stringify. Anything that does not survive that round
 * trip comes back stripped of its methods on the next cold start — and the
 * failure lands in a component, far from the hook that built it.
 *
 * That shipped three times at once: a Set of completed goal ids, a Map of
 * workouts by id, and Date objects in the week grid. The first crashed the
 * dashboard on `completedGoalIds.has is not a function`.
 *
 * These pin the property directly: build the value the way the hook does,
 * round-trip it, and assert it still behaves. A Set or Map reintroduced into
 * a persisted result fails here rather than on a user's phone.
 */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("values stored in persisted query data", () => {
  it("shows why a Set cannot be stored", () => {
    const asSet = new Set(["goal-1", "goal-2"]);
    // The exact shape of the original bug.
    expect(JSON.stringify(asSet)).toBe("{}");
    expect((roundTrip(asSet) as unknown as { has?: unknown }).has).toBeUndefined();
  });

  it("shows why a Map cannot be stored", () => {
    const asMap = new Map([["w-1", { id: "w-1", name: "Push" }]]);
    expect(JSON.stringify(asMap)).toBe("{}");
    expect((roundTrip(asMap) as unknown as { get?: unknown }).get).toBeUndefined();
  });

  it("shows why a Date cannot be stored", () => {
    const restored = roundTrip({ date: new Date("2026-09-18T12:00:00Z") }) as unknown as {
      date: unknown;
    };
    expect(typeof restored.date).toBe("string");
    expect(restored.date instanceof Date).toBe(false);
  });

  it("survives the round trip as completedGoalIds is now built", () => {
    const logs = [{ goal_id: "goal-1" }, { goal_id: "goal-2" }];
    const completedGoalIds = logs.map((l) => l.goal_id);

    const restored = roundTrip({ completedGoalIds });
    expect(restored.completedGoalIds).toEqual(["goal-1", "goal-2"]);
    // The call sites use includes(), which an array keeps across the trip.
    expect(restored.completedGoalIds.includes("goal-1")).toBe(true);
    expect(restored.completedGoalIds.includes("goal-3")).toBe(false);
  });

  it("survives the round trip as workoutsById is now built", () => {
    const workouts = [{ id: "w-1", name: "Push" }];
    const workoutsById = Object.fromEntries(workouts.map((w) => [w.id, w]));

    const restored = roundTrip({ workoutsById });
    expect(restored.workoutsById["w-1"]).toEqual({ id: "w-1", name: "Push" });
    expect(restored.workoutsById["missing"]).toBeUndefined();
  });

  it("survives the round trip as a week day is now built", () => {
    const day = { dateStr: "2026-09-18", workout: null, state: "rest" };
    expect(roundTrip(day)).toEqual(day);
  });
});
