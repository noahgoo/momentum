import { describe, expect, it } from "vitest";
import { resolveTargetWeight, resolvedSetConfig } from "./resolveTargetWeight";

const lbs = (weight: number) => ({ weight, weight_unit: "lbs" as const });

describe("resolveTargetWeight", () => {
  describe("fixed targets (no weightDelta)", () => {
    it("passes the coach's number through untouched", () => {
      expect(resolveTargetWeight({ reps: 8, weight: 95, weightUnit: "lbs" }, undefined))
        .toEqual({ weight: 95, weightUnit: "lbs" });
    });

    it("ignores any prior, because a fixed target is not a progression", () => {
      expect(resolveTargetWeight({ reps: 8, weight: 95, weightUnit: "lbs" }, lbs(200)))
        .toEqual({ weight: 95, weightUnit: "lbs" });
    });

    // P5: a bodyweight exercise carries no weight and must not become 0.
    it("leaves a bodyweight exercise with no weight", () => {
      expect(resolveTargetWeight({ reps: 12 }, undefined).weight).toBeUndefined();
    });

    it("keeps a genuine fixed target of 0", () => {
      expect(resolveTargetWeight({ reps: 8, weight: 0, weightUnit: "lbs" }, undefined).weight)
        .toBe(0);
    });
  });

  describe("increment targets", () => {
    const plus5 = { reps: 8, weightUnit: "lbs" as const, weightDelta: 5 };

    it("adds the delta to the prior for the same set number", () => {
      expect(resolveTargetWeight(plus5, lbs(135))).toEqual({ weight: 140, weightUnit: "lbs" });
    });

    // The whole point of asking for "+5 each week".
    it("preserves a ramp across sets", () => {
      expect(resolveTargetWeight(plus5, lbs(135)).weight).toBe(140);
      expect(resolveTargetWeight(plus5, lbs(155)).weight).toBe(160);
      expect(resolveTargetWeight(plus5, lbs(175)).weight).toBe(180);
    });

    it("holds the weight on a zero delta", () => {
      expect(resolveTargetWeight({ ...plus5, weightDelta: 0 }, lbs(135)).weight).toBe(135);
    });

    it("subtracts on a deload", () => {
      expect(resolveTargetWeight({ ...plus5, weightDelta: -10 }, lbs(135)).weight).toBe(125);
    });

    // Would otherwise violate setConfigSchema's weight: nonnegative().
    it("clamps a deload at zero rather than going negative", () => {
      expect(resolveTargetWeight({ ...plus5, weightDelta: -10 }, lbs(5)).weight).toBe(0);
    });

    it("wins over a fixed weight retained underneath", () => {
      const both = { reps: 8, weight: 95, weightUnit: "lbs" as const, weightDelta: 5 };
      expect(resolveTargetWeight(both, lbs(135)).weight).toBe(140);
    });
  });

  describe("cases that must render blank, not guess", () => {
    const plus5 = { reps: 8, weightUnit: "lbs" as const, weightDelta: 5 };

    it("blanks when the client has no prior for this set", () => {
      expect(resolveTargetWeight(plus5, undefined).weight).toBeUndefined();
    });

    // P6: never aggregate two weights without checking units match.
    it("blanks on a unit mismatch rather than converting", () => {
      expect(resolveTargetWeight(plus5, { weight: 60, weight_unit: "kg" }).weight).toBeUndefined();
    });

    it("blanks when the prior carries no unit at all", () => {
      expect(resolveTargetWeight(plus5, { weight: 135, weight_unit: null }).weight).toBeUndefined();
    });

    it("keeps the unit so the column can still label itself", () => {
      expect(resolveTargetWeight(plus5, undefined).weightUnit).toBe("lbs");
    });
  });
});

describe("resolvedSetConfig", () => {
  it("snapshots the resolved weight and keeps the delta as provenance", () => {
    const cfg = { reps: 8, weightUnit: "lbs" as const, weightDelta: 5 };
    expect(resolvedSetConfig(cfg, lbs(135))).toEqual({
      reps: 8,
      weight: 140,
      weightUnit: "lbs",
      weightDelta: 5,
    });
  });

  it("omits weight entirely when unresolvable, so history shows an em dash", () => {
    const cfg = { reps: 8, weightUnit: "lbs" as const, weightDelta: 5 };
    expect(resolvedSetConfig(cfg, undefined)).not.toHaveProperty("weight");
  });

  it("carries perSide through untouched", () => {
    const cfg = { reps: 10, perSide: true, weightUnit: "lbs" as const, weightDelta: 5 };
    expect(resolvedSetConfig(cfg, lbs(20)).perSide).toBe(true);
  });

  it("leaves a fixed config alone", () => {
    const cfg = { reps: 8, weight: 95, weightUnit: "lbs" as const };
    expect(resolvedSetConfig(cfg, lbs(200))).toEqual(cfg);
  });
});
