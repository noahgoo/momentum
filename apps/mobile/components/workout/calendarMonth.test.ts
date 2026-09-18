import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  daysInMonth,
  initialMonthKey,
  isWithinRange,
  monthHasSelectableDay,
  monthKeyOf,
  monthLabel,
  shiftMonth,
} from "./calendarMonth";

describe("monthKeyOf / monthLabel", () => {
  it("takes the month off a date", () => {
    expect(monthKeyOf("2026-09-18")).toBe("2026-09");
  });

  it("names the month", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthLabel("2026-01")).toBe("January 2026");
  });

  // Parsing at midnight UTC would render December 2025 west of Greenwich.
  it("does not slip a month at the January boundary", () => {
    expect(monthLabel("2026-01")).toContain("2026");
  });
});

describe("shiftMonth", () => {
  it("moves within a year", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
    expect(shiftMonth("2026-09", -1)).toBe("2026-08");
  });

  it("rolls the year over in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("handles multi-year jumps", () => {
    expect(shiftMonth("2026-05", 24)).toBe("2028-05");
    expect(shiftMonth("2026-05", -17)).toBe("2024-12");
  });
});

describe("daysInMonth", () => {
  it("knows month lengths", () => {
    expect(daysInMonth("2026-01")).toBe(31);
    expect(daysInMonth("2026-04")).toBe(30);
    expect(daysInMonth("2026-02")).toBe(28);
  });

  it("handles leap years", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2000-02")).toBe(29);
    expect(daysInMonth("1900-02")).toBe(28);
  });
});

describe("buildMonthGrid", () => {
  it("pads so the 1st sits under its real weekday", () => {
    // 2026-09-01 is a Tuesday, so two leading blanks (Sun, Mon).
    const cells = buildMonthGrid("2026-09");
    expect(cells.slice(0, 2)).toEqual([null, null]);
    expect(cells[2]).toBe("2026-09-01");
  });

  it("emits every day of the month, zero-padded", () => {
    const cells = buildMonthGrid("2026-09").filter(Boolean);
    expect(cells).toHaveLength(30);
    expect(cells[0]).toBe("2026-09-01");
    expect(cells[29]).toBe("2026-09-30");
  });

  it("starts with no blanks when the 1st is a Sunday", () => {
    // 2026-02-01 is a Sunday.
    expect(buildMonthGrid("2026-02")[0]).toBe("2026-02-01");
  });

  it("covers February in a leap year", () => {
    expect(buildMonthGrid("2028-02").filter(Boolean)).toHaveLength(29);
  });
});

describe("isWithinRange", () => {
  it("is inclusive at both ends", () => {
    expect(isWithinRange("2026-09-18", "2026-09-18", "2026-10-20")).toBe(true);
    expect(isWithinRange("2026-10-20", "2026-09-18", "2026-10-20")).toBe(true);
  });

  it("rejects outside", () => {
    expect(isWithinRange("2026-09-17", "2026-09-18", "2026-10-20")).toBe(false);
    expect(isWithinRange("2026-10-21", "2026-09-18", "2026-10-20")).toBe(false);
  });

  // The whole reason dates stay strings: comparison is exact and needs no
  // parsing, so it cannot pick up a device offset.
  it("compares correctly across month and year boundaries", () => {
    expect(isWithinRange("2026-10-01", "2026-09-30", "2026-10-02")).toBe(true);
    expect(isWithinRange("2027-01-01", "2026-12-31", "2027-01-02")).toBe(true);
  });
});

describe("monthHasSelectableDay", () => {
  it("is true for months inside the window", () => {
    expect(monthHasSelectableDay("2026-09", "2026-09-18", "2026-11-02")).toBe(true);
    expect(monthHasSelectableDay("2026-10", "2026-09-18", "2026-11-02")).toBe(true);
    expect(monthHasSelectableDay("2026-11", "2026-09-18", "2026-11-02")).toBe(true);
  });

  it("is false beyond either edge", () => {
    expect(monthHasSelectableDay("2026-08", "2026-09-18", "2026-11-02")).toBe(false);
    expect(monthHasSelectableDay("2026-12", "2026-09-18", "2026-11-02")).toBe(false);
  });
});

describe("initialMonthKey", () => {
  it("opens on the selected day's month", () => {
    expect(initialMonthKey("2026-10-05", "2026-09-18")).toBe("2026-10");
  });

  it("falls back to the window's first month when nothing is selected", () => {
    expect(initialMonthKey("", "2026-09-18")).toBe("2026-09");
  });
});
