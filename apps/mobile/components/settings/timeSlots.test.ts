import { describe, expect, it } from "vitest";
import { buildSlots, formatSlotLabel, formatStoredTime, nearestSlotValue } from "./timeSlots";

/**
 * C1a: the picker's granularity must match the scheduler's. Reminders run
 * every 15 minutes and match to the quarter hour, so every value this control
 * can produce has to be a quarter hour — otherwise the client's choice is
 * silently rounded at send time. These pin that, and the rule says the picker
 * changes in the same commit as the cron interval.
 */
describe("buildSlots", () => {
  const slots = buildSlots();

  it("covers a full day at quarter-hour resolution", () => {
    expect(slots).toHaveLength(96);
    expect(slots[0]!.value).toBe("00:00");
    expect(slots[95]!.value).toBe("23:45");
  });

  it("only ever offers a minute the scheduler visits", () => {
    for (const slot of slots) {
      expect([0, 15, 30, 45]).toContain(slot.minute);
    }
  });

  it("is ordered and free of duplicates", () => {
    const values = slots.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort()).toEqual(values);
  });
});

describe("formatSlotLabel", () => {
  it("reads midnight and noon as 12, not 0", () => {
    expect(formatSlotLabel(0, 0)).toBe("12:00 AM");
    expect(formatSlotLabel(12, 0)).toBe("12:00 PM");
  });

  it("pads the minute", () => {
    expect(formatSlotLabel(8, 0)).toBe("8:00 AM");
    expect(formatSlotLabel(8, 5)).toBe("8:05 AM");
  });

  it("carries the period across the boundary", () => {
    expect(formatSlotLabel(11, 45)).toBe("11:45 AM");
    expect(formatSlotLabel(13, 30)).toBe("1:30 PM");
    expect(formatSlotLabel(23, 45)).toBe("11:45 PM");
  });
});

describe("nearestSlotValue", () => {
  // Values predating the quarter-hour picker exist, and the scheduler floors
  // them the same way — so the field must show the slot that will actually
  // fire, not the number that happens to be stored.
  it("floors an off-grid time the way the scheduler does", () => {
    expect(nearestSlotValue("07:50")).toBe("07:45");
    expect(nearestSlotValue("07:01")).toBe("07:00");
    expect(nearestSlotValue("07:59")).toBe("07:45");
  });

  it("leaves a value already on the grid alone", () => {
    expect(nearestSlotValue("08:00")).toBe("08:00");
    expect(nearestSlotValue("08:15")).toBe("08:15");
  });

  it("accepts a seconds suffix, which Postgres time columns return", () => {
    expect(nearestSlotValue("08:30:00")).toBe("08:30");
  });

  it("falls back when there is nothing usable stored", () => {
    expect(nearestSlotValue(null)).toBe("08:00");
    expect(nearestSlotValue("")).toBe("08:00");
    expect(nearestSlotValue("not a time")).toBe("08:00");
    expect(nearestSlotValue("99:99")).toBe("08:00");
  });

  it("always lands on a value the list contains", () => {
    const values = new Set(buildSlots().map((s) => s.value));
    for (const stored of ["00:00", "07:50", "12:34", "23:59", "08:30:00"]) {
      expect(values.has(nearestSlotValue(stored))).toBe(true);
    }
  });
});

describe("formatStoredTime", () => {
  it("renders a stored value the same way the list does", () => {
    expect(formatStoredTime("08:15")).toBe("8:15 AM");
    expect(formatStoredTime("00:00")).toBe("12:00 AM");
  });
});
