import { describe, expect, it } from "vitest";
import { suggestTargets } from "./moveSuggestions";

const TODAY = "2026-10-21";
const REST = ["2026-10-21", "2026-10-23", "2026-10-25", "2026-10-26"];

describe("suggestTargets", () => {
  it("sends missed workouts to the soonest free days, one each", () => {
    const result = suggestTargets(["2026-10-14", "2026-10-16", "2026-10-19"], REST, TODAY);
    expect(result).toEqual({
      "2026-10-14": "2026-10-21",
      "2026-10-16": "2026-10-23",
      "2026-10-19": "2026-10-25",
    });
  });

  it("keeps an upcoming workout near where it was", () => {
    const result = suggestTargets(["2026-10-24"], REST, TODAY);
    // Equidistant between the 23rd and 25th: the later day wins the tie.
    expect(result["2026-10-24"]).toBe("2026-10-25");
  });

  it("never hands the same day out twice", () => {
    const result = suggestTargets(["2026-10-14", "2026-10-15"], ["2026-10-21", "2026-10-22"], TODAY);
    expect(new Set(Object.values(result)).size).toBe(2);
  });

  it("keeps a target the client already chose, and does not reuse it", () => {
    const result = suggestTargets(["2026-10-14", "2026-10-16"], REST, TODAY, { "2026-10-16": "2026-10-21" });
    expect(result["2026-10-16"]).toBe("2026-10-21");
    expect(result["2026-10-14"]).toBe("2026-10-23");
  });

  it("leaves a workout without a target when no rest day is left", () => {
    const result = suggestTargets(["2026-10-14", "2026-10-15"], ["2026-10-21"], TODAY);
    expect(Object.keys(result)).toEqual(["2026-10-14"]);
  });

  it("returns nothing when there are no rest days at all", () => {
    expect(suggestTargets(["2026-10-14"], [], TODAY)).toEqual({});
  });
});
