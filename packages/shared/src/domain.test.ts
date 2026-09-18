import { describe, expect, it } from "vitest";
import {
  parseSetConfig,
  parseSetConfigs,
  serializeSetConfig,
  serializeSetConfigs,
  type SetConfig,
} from "./domain";

/**
 * These cover the five-part threading described on `SetConfig`: a field added
 * to the interface but missed in the parser or the serializer vanishes
 * silently, and nothing else in the app would catch it. Every field gets a
 * round-trip assertion, and P5 (absent is not zero) gets its own.
 */
describe("parseSetConfig", () => {
  it("reads every known field from the stored snake_case shape", () => {
    expect(
      parseSetConfig({
        reps: 8,
        weight: 95,
        weight_unit: "lbs",
        seconds: 45,
        miles: 1.5,
        pace_seconds: 510,
        per_side: true,
        weight_delta: 5,
      })
    ).toEqual({
      reps: 8,
      weight: 95,
      weightUnit: "lbs",
      seconds: 45,
      miles: 1.5,
      paceSeconds: 510,
      perSide: true,
      weightDelta: 5,
    });
  });

  it("drops absent, null and malformed fields rather than coercing them", () => {
    expect(parseSetConfig({ reps: 10, weight: null, weight_unit: null })).toEqual({ reps: 10 });
    expect(parseSetConfig({ weight: "95", per_side: "yes", weight_delta: "5" })).toEqual({});
    expect(parseSetConfig({ weight_unit: "stone" })).toEqual({});
    expect(parseSetConfig({ reps: Number.NaN, weight_delta: Number.POSITIVE_INFINITY })).toEqual({});
    expect(parseSetConfig(null)).toEqual({});
    expect(parseSetConfig("nonsense")).toEqual({});
  });

  // P5: `—` means nothing was recorded, `0` means zero. A truthiness check
  // anywhere in the parse path would collapse the two.
  it("keeps a genuine zero and a negative delta", () => {
    expect(parseSetConfig({ reps: 0, weight: 0 })).toEqual({ reps: 0, weight: 0 });
    expect(parseSetConfig({ weight_delta: 0 })).toEqual({ weightDelta: 0 });
    expect(parseSetConfig({ weight_delta: -5 })).toEqual({ weightDelta: -5 });
  });

  it("distinguishes an absent flag from an explicit false", () => {
    expect(parseSetConfig({ reps: 10 }).perSide).toBeUndefined();
    expect(parseSetConfig({ reps: 10, per_side: false }).perSide).toBe(false);
  });
});

describe("serializeSetConfig", () => {
  it("round-trips every field back to the stored shape", () => {
    const config: SetConfig = {
      reps: 8,
      weight: 95,
      weightUnit: "lbs",
      seconds: 45,
      miles: 1.5,
      paceSeconds: 510,
      perSide: true,
      weightDelta: 5,
    };
    expect(parseSetConfig(serializeSetConfig(config))).toEqual(config);
  });

  it("omits absent fields instead of writing nulls", () => {
    expect(serializeSetConfig({ reps: 10 })).toEqual({ reps: 10 });
  });

  it("writes a zero and a negative delta rather than dropping them", () => {
    expect(serializeSetConfig({ reps: 0, weight: 0, weightDelta: 0 })).toEqual({
      reps: 0,
      weight: 0,
      weight_delta: 0,
    });
    expect(serializeSetConfig({ weightDelta: -5 })).toEqual({ weight_delta: -5 });
    expect(serializeSetConfig({ perSide: false })).toEqual({ per_side: false });
  });

  // A fixed weight retained under an active increment is a legal row: the
  // delta wins, and toggling the increment off restores the coach's number.
  it("keeps weight and weightDelta together", () => {
    const both: SetConfig = { reps: 8, weight: 95, weightUnit: "lbs", weightDelta: 5 };
    expect(parseSetConfig(serializeSetConfig(both))).toEqual(both);
  });
});

describe("parseSetConfigs / serializeSetConfigs", () => {
  it("round-trips an array", () => {
    const configs: SetConfig[] = [
      { reps: 8, weight: 95, weightUnit: "lbs" },
      { reps: 8, weightUnit: "lbs", weightDelta: 5, perSide: true },
    ];
    expect(parseSetConfigs(serializeSetConfigs(configs))).toEqual(configs);
  });

  it("returns an empty array for a non-array", () => {
    expect(parseSetConfigs(null)).toEqual([]);
    expect(parseSetConfigs({ reps: 8 })).toEqual([]);
  });
});
