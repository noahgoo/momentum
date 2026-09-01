import { describe, expect, it } from "vitest";
import {
  computeSwapOverrides,
  getWorkoutIdForDate,
  parseDateStr,
  resolveWeekSchedule,
} from "./schedule.js";
import type { AssignmentPreview, ProgramPreview } from "./types.js";
import scheduleCases from "../test-fixtures/schedule-cases.json" with { type: "json" };

interface ScheduleCase {
  name: string;
  startDate: string;
  program: ProgramPreview;
  overrides: Record<string, string | null>;
  date: string;
  expected: string | null;
}

describe("parseDateStr", () => {
  it("parses a valid YYYY-MM-DD string as a local date", () => {
    const d = parseDateStr("2026-08-31");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7); // August = 7
    expect(d!.getDate()).toBe(31);
  });

  it("returns null for malformed input", () => {
    expect(parseDateStr("not-a-date")).toBeNull();
    expect(parseDateStr("2026/08/31")).toBeNull();
    expect(parseDateStr("")).toBeNull();
  });
});

describe("resolveWeekSchedule", () => {
  it("returns flat weekSchedule when no phases", () => {
    const program: ProgramPreview = {
      id: "p1",
      weeks: 2,
      weekSchedule: {
        "1": { monday: "w1" },
        "2": { monday: "w2" },
      },
    };
    expect(resolveWeekSchedule(program)).toEqual(program.weekSchedule);
  });

  it("merges phases into contiguous global week keys", () => {
    const program: ProgramPreview = {
      id: "p1",
      weeks: 3,
      weekSchedule: {},
      phases: [
        {
          id: "a",
          weeks: 2,
          weekSchedule: {
            "1": { monday: "a1" },
            "2": { monday: "a2" },
          },
        },
        {
          id: "b",
          weeks: 1,
          weekSchedule: {
            "1": { monday: "b1" },
          },
        },
      ],
    };
    const merged = resolveWeekSchedule(program);
    expect(merged["1"]?.monday).toBe("a1");
    expect(merged["2"]?.monday).toBe("a2");
    expect(merged["3"]?.monday).toBe("b1");
  });

  it("treats an empty phases array the same as no phases", () => {
    const program: ProgramPreview = {
      id: "p1",
      weeks: 1,
      weekSchedule: { "1": { monday: "w1" } },
      phases: [],
    };
    expect(resolveWeekSchedule(program)).toEqual(program.weekSchedule);
  });
});

describe("getWorkoutIdForDate (fixture-driven)", () => {
  const cases = scheduleCases as unknown as ScheduleCase[];

  for (const c of cases) {
    it(c.name, () => {
      const assignment: AssignmentPreview = {
        startDate: c.startDate,
        program: c.program,
        overrides: c.overrides,
      };
      expect(getWorkoutIdForDate(assignment, c.date)).toBe(c.expected);
    });
  }
});

describe("computeSwapOverrides", () => {
  it("swaps two scheduled workouts", () => {
    expect(computeSwapOverrides("2026-06-29", "2026-06-30", "w1", "w2")).toEqual({
      "2026-06-29": "w2",
      "2026-06-30": "w1",
    });
  });

  it("swaps a workout with a rest day (toDate had no workout)", () => {
    expect(computeSwapOverrides("2026-06-29", "2026-06-30", "w1", null)).toEqual({
      "2026-06-29": null,
      "2026-06-30": "w1",
    });
  });

  it("returns null when the dates are the same", () => {
    expect(computeSwapOverrides("2026-06-29", "2026-06-29", "w1", "w2")).toBeNull();
  });

  it("returns null when nothing is scheduled on the from-date", () => {
    expect(computeSwapOverrides("2026-06-29", "2026-06-30", null, "w2")).toBeNull();
  });

  it("moving a workout onto a rest day and back is a no-op round trip", () => {
    const first = computeSwapOverrides("2026-06-29", "2026-06-30", "w1", null);
    expect(first).toEqual({ "2026-06-29": null, "2026-06-30": "w1" });
    // Swapping back: fromDate is now toDate (has w1), toDate is now fromDate (rest, null).
    const back = computeSwapOverrides("2026-06-30", "2026-06-29", "w1", null);
    expect(back).toEqual({ "2026-06-30": null, "2026-06-29": "w1" });
  });
});
