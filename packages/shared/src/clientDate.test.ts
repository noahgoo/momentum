import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  addDaysStr,
  mondayOfStr,
  clientDateStr,
  clientToday,
  isSameClientDay,
} from "./clientDate.js";

/** 2026-03-03T06:30:00Z — 10:30pm Mar 2 in LA, 1:30am Mar 3 in NY, 3:30pm Mar 3 in Tokyo. */
const CROSS_MIDNIGHT = new Date("2026-03-03T06:30:00Z");

describe("clientDateStr", () => {
  it("returns YYYY-MM-DD", () => {
    expect(clientDateStr("UTC", new Date("2026-06-15T12:00:00Z"))).toBe("2026-06-15");
  });

  it("gives different calendar days for the same instant in different zones", () => {
    // This is the whole point: one moment, three different 'today's.
    expect(clientDateStr("America/Los_Angeles", CROSS_MIDNIGHT)).toBe("2026-03-02");
    expect(clientDateStr("America/New_York", CROSS_MIDNIGHT)).toBe("2026-03-03");
    expect(clientDateStr("Asia/Tokyo", CROSS_MIDNIGHT)).toBe("2026-03-03");
  });

  it("handles a zone ahead of the international date line", () => {
    expect(clientDateStr("Pacific/Auckland", new Date("2026-06-15T13:00:00Z"))).toBe("2026-06-16");
  });

  it("falls back to the default zone when timezone is nullish", () => {
    const at = new Date("2026-06-15T12:00:00Z");
    expect(clientDateStr(null, at)).toBe(clientDateStr(DEFAULT_TIMEZONE, at));
    expect(clientDateStr(undefined, at)).toBe(clientDateStr(DEFAULT_TIMEZONE, at));
  });

  it("falls back rather than throwing on an invalid IANA zone", () => {
    const at = new Date("2026-06-15T12:00:00Z");
    expect(() => clientDateStr("Not/A_Zone", at)).not.toThrow();
    expect(clientDateStr("Not/A_Zone", at)).toBe(clientDateStr(DEFAULT_TIMEZONE, at));
  });
});

describe("clientDateStr across DST", () => {
  // US DST 2026 begins Mar 8, ends Nov 1.
  it("is stable across the spring-forward boundary", () => {
    // 06:30Z on Mar 8 is 1:30am EST; the jump to 3am happens at 07:00Z.
    expect(clientDateStr("America/New_York", new Date("2026-03-08T06:30:00Z"))).toBe("2026-03-08");
    expect(clientDateStr("America/New_York", new Date("2026-03-08T08:00:00Z"))).toBe("2026-03-08");
  });

  it("is stable across the fall-back boundary", () => {
    expect(clientDateStr("America/New_York", new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(clientDateStr("America/New_York", new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
  });

  it("rolls to the next day at local midnight, not UTC midnight", () => {
    // 04:59Z is 11:59pm EST Mar 2; 05:00Z is 12:00am EST Mar 3.
    expect(clientDateStr("America/New_York", new Date("2026-03-03T04:59:00Z"))).toBe("2026-03-02");
    expect(clientDateStr("America/New_York", new Date("2026-03-03T05:00:00Z"))).toBe("2026-03-03");
  });
});

describe("clientToday", () => {
  it("agrees with clientDateStr for the current instant", () => {
    expect(clientToday("Asia/Tokyo")).toBe(clientDateStr("Asia/Tokyo"));
  });
});

describe("isSameClientDay", () => {
  it("is true for two instants inside one local day", () => {
    expect(
      isSameClientDay(
        "America/New_York",
        new Date("2026-06-15T13:00:00Z"),
        new Date("2026-06-15T23:00:00Z")
      )
    ).toBe(true);
  });

  it("is false across a local midnight even when UTC agrees", () => {
    // Both are 2026-06-16 in UTC, but straddle midnight in New York.
    expect(
      isSameClientDay(
        "America/New_York",
        new Date("2026-06-16T03:00:00Z"),
        new Date("2026-06-16T05:00:00Z")
      )
    ).toBe(false);
  });
});

describe("addDaysStr", () => {
  it("adds and subtracts days", () => {
    expect(addDaysStr("2026-06-15", 1)).toBe("2026-06-16");
    expect(addDaysStr("2026-06-15", -1)).toBe("2026-06-14");
    expect(addDaysStr("2026-06-15", 0)).toBe("2026-06-15");
  });

  it("crosses month and year boundaries", () => {
    expect(addDaysStr("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysStr("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysStr("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles leap years", () => {
    expect(addDaysStr("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysStr("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("is unaffected by a DST shift in the middle of the range", () => {
    // Calendar arithmetic must not lose or gain a day to a 23/25-hour day.
    expect(addDaysStr("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDaysStr("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("returns the input unchanged when it is not a date string", () => {
    expect(addDaysStr("nonsense", 1)).toBe("nonsense");
  });
});

describe("mondayOfStr", () => {
  it("returns the Monday of the containing week", () => {
    // 2026-06-15 is a Monday.
    expect(mondayOfStr("2026-06-15")).toBe("2026-06-15");
    expect(mondayOfStr("2026-06-17")).toBe("2026-06-15"); // Wednesday
    expect(mondayOfStr("2026-06-20")).toBe("2026-06-15"); // Saturday
  });

  it("treats Sunday as the END of its week, not the start", () => {
    // 2026-06-21 is a Sunday; its Monday is six days back, not the next day.
    expect(mondayOfStr("2026-06-21")).toBe("2026-06-15");
  });

  it("crosses a month boundary", () => {
    expect(mondayOfStr("2026-07-01")).toBe("2026-06-29"); // Wednesday
  });
});
