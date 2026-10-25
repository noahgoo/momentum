import { describe, expect, it } from "vitest";
import {
  computePace,
  describeResult,
  describeTarget,
  digitsFromSeconds,
  digitsFromText,
  exerciseBadges,
  formatDistance,
  formatPace,
  formatTargetReps,
  formatTargetWeight,
  formatWeight,
  maskDigits,
  paceSuffix,
  parseDecimal,
  secondsFromDigits,
} from "./workoutFormat";

describe("formatWeight / formatTargetWeight", () => {
  it("always shows the unit when one is recorded", () => {
    expect(formatWeight(135, "lbs")).toBe("135 lb");
    expect(formatWeight(60, "kg")).toBe("60 kg");
  });

  it("shows a bare number for a legacy row with no unit rather than guessing one (P6)", () => {
    expect(formatWeight(135, null)).toBe("135");
  });

  it("keeps a real zero and renders absent as an em dash (P5)", () => {
    expect(formatWeight(0, "lbs")).toBe("0 lb");
    expect(formatWeight(undefined, "lbs")).toBe("—");
    expect(formatWeight(null, null)).toBe("—");
  });

  it("reads bodyweight as BW, not an empty target", () => {
    expect(formatTargetWeight({ reps: 10, loadType: "bodyweight" })).toBe("BW");
    expect(formatTargetWeight({ reps: 10 })).toBe("—");
  });
});

describe("formatTargetReps", () => {
  it("marks per-side reps", () => {
    expect(formatTargetReps({ reps: 10, perSide: true })).toBe("10 /side");
  });

  it("keeps 0 reps and shows max effort as Max, not missing", () => {
    expect(formatTargetReps({ reps: 0 })).toBe("0");
    expect(formatTargetReps({ maxEffort: true })).toBe("Max");
    expect(formatTargetReps({})).toBe("—");
  });
});

describe("distance and pace", () => {
  it("shows the unit it was prescribed in", () => {
    expect(formatDistance(3, "mi")).toBe("3 mi");
    expect(formatDistance(5.256, "km")).toBe("5.26 km");
    expect(formatDistance(undefined, "km")).toBe("—");
  });

  it("derives pace per distance unit", () => {
    expect(computePace(5, 1650)).toBe(330);
    expect(formatPace(330)).toBe("5:30");
    expect(paceSuffix("km")).toBe("/km");
    expect(paceSuffix("mi")).toBe("/mi");
  });
});

describe("describeTarget", () => {
  it("spells out what the weight means", () => {
    expect(describeTarget("reps", { reps: 10, weight: 25, weightUnit: "lbs", loadType: "each_hand" })).toBe(
      "10 reps × 25 lb each hand"
    );
    expect(describeTarget("reps", { reps: 8, weight: 185, weightUnit: "lbs", loadType: "total" })).toBe(
      "8 reps × 185 lb"
    );
    expect(describeTarget("reps", { reps: 12, loadType: "bodyweight" })).toBe("12 reps");
    expect(describeTarget("reps", { reps: 8, weight: 25, weightUnit: "lbs", loadType: "bodyweight_plus" })).toBe(
      "8 reps × BW + 25 lb"
    );
    expect(describeTarget("reps", { reps: 8, weight: 40, weightUnit: "lbs", loadType: "assisted" })).toBe(
      "8 reps × assisted 40 lb"
    );
  });

  it("handles per-side, max effort, time and distance", () => {
    expect(describeTarget("reps", { reps: 10, perSide: true })).toBe("10 reps each side");
    expect(describeTarget("reps", { maxEffort: true })).toBe("Max reps");
    expect(describeTarget("time", { seconds: 45, perSide: true })).toBe("45s each side");
    expect(describeTarget("time", { maxEffort: true })).toBe("Hold max");
    expect(describeTarget("distance", { distance: 5, distanceUnit: "km", paceSeconds: 330 })).toBe(
      "5 km @ 5:30/km"
    );
  });

  it("shows an em dash for a target with nothing in it", () => {
    expect(describeTarget("reps", {})).toBe("—");
    expect(describeTarget("time", {})).toBe("—");
  });
});

describe("exerciseBadges", () => {
  it("collects load type, per-side and max from any set", () => {
    expect(exerciseBadges([{ reps: 10, loadType: "each_hand", perSide: true }, { reps: 10 }])).toEqual([
      "EACH HAND",
      "EACH SIDE",
    ]);
    expect(exerciseBadges([{ maxEffort: true }])).toEqual(["MAX"]);
    expect(exerciseBadges([{ reps: 10 }])).toEqual([]);
  });
});

describe("parseDecimal", () => {
  it("accepts dot or comma and whole numbers", () => {
    expect(parseDecimal("22.5")).toBe(22.5);
    expect(parseDecimal("22,5")).toBe(22.5);
    expect(parseDecimal("135")).toBe(135);
    expect(parseDecimal("0")).toBe(0);
    expect(parseDecimal("5.")).toBe(5);
  });

  it("never returns NaN for partial or junk input", () => {
    expect(parseDecimal("")).toBeUndefined();
    expect(parseDecimal(".")).toBeUndefined();
    expect(parseDecimal("1.2.3")).toBeUndefined();
    expect(parseDecimal("abc")).toBeUndefined();
    expect(parseDecimal("-5")).toBeUndefined();
  });
});

describe("digit-shift time entry", () => {
  const typed = (keys: string) => maskDigits(digitsFromText(keys));

  it("fills in from the right like a timer", () => {
    expect(typed("3")).toBe("0:03");
    expect(typed("30")).toBe("0:30");
    expect(typed("300")).toBe("3:00");
    expect(typed("2430")).toBe("24:30");
    expect(typed("30000")).toBe("3:00:00");
    expect(typed("130000")).toBe("13:00:00");
  });

  it("makes 30 mean thirty seconds and 3000 mean thirty minutes, unambiguously", () => {
    expect(secondsFromDigits(digitsFromText("30"))).toBe(30);
    expect(secondsFromDigits(digitsFromText("3000"))).toBe(1800);
  });

  it("converts digits to seconds and back", () => {
    expect(secondsFromDigits("2430")).toBe(24 * 60 + 30);
    expect(secondsFromDigits("10530")).toBe(3600 + 5 * 60 + 30);
    expect(digitsFromSeconds(1470)).toBe("2430");
    expect(digitsFromSeconds(3930)).toBe("10530");
    expect(digitsFromSeconds(45)).toBe("45");
  });

  it("clears completely and ignores non-digits", () => {
    expect(typed("")).toBe("");
    expect(secondsFromDigits("")).toBeUndefined();
    expect(digitsFromText("1:5a")).toBe("15");
    expect(digitsFromSeconds(undefined)).toBe("");
  });
});

describe("describeResult", () => {
  const blank = {
    reps: null,
    weight: null,
    weight_unit: null,
    actual_seconds: null,
    actual_distance: null,
    distance_unit: null,
  };

  it("reads reps and weight with the unit they were logged in", () => {
    expect(describeResult("reps", { ...blank, reps: 8, weight: 22.5, weight_unit: "kg" })).toBe("8 × 22.5 kg");
    expect(describeResult("reps", { ...blank, reps: 12 })).toBe("12 reps");
  });

  it("shows an em dash for an unrecorded set and keeps a real zero (P5)", () => {
    expect(describeResult("reps", blank)).toBe("—");
    expect(describeResult("reps", { ...blank, reps: 0 })).toBe("0 reps");
  });

  it("reports distance with time and pace in the logged unit", () => {
    expect(
      describeResult("distance", { ...blank, actual_distance: 5, distance_unit: "km", actual_seconds: 1650 })
    ).toBe("5 km · 27:30 · 5:30/km");
    expect(describeResult("distance", blank)).toBe("—");
  });
});
