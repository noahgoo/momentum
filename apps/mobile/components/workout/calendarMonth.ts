/**
 * Month-grid maths for the date picker, in YYYY-MM-DD strings throughout.
 *
 * Strings, not Date objects, on purpose: every date this app stores or compares
 * is a wall-clock day in the CLIENT's timezone (rule C1), and a Date carries
 * the device's offset instead. Keeping the arithmetic on strings means a
 * picker cannot quietly shift a day for a travelling client.
 *
 * Where a weekday or a month length is genuinely needed, a Date is built at
 * MIDDAY — parsing "2026-09-01" as UTC midnight lands on August 31st anywhere
 * west of Greenwich.
 */

/** "2026-09-18" -> "2026-09" */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/** "2026-09" -> "September 2026" */
export function monthLabel(monthKey: string): string {
  const d = new Date(`${monthKey}-01T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Moves a month key by whole months, rolling the year over. */
export function shiftMonth(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const zeroBased = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export function daysInMonth(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

/**
 * The cells of a month grid, Sunday-first. Leading blanks are null so the 1st
 * lands under its real weekday; there is no trailing padding, since a partial
 * last row lays out correctly on its own.
 */
export function buildMonthGrid(monthKey: string): (string | null)[] {
  const firstDow = new Date(`${monthKey}-01T12:00:00`).getDay();
  const total = daysInMonth(monthKey);
  const cells: (string | null)[] = Array.from({ length: firstDow }, () => null);
  for (let day = 1; day <= total; day += 1) {
    cells.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  }
  return cells;
}

/** Inclusive range check. Lexicographic compare is exact for YYYY-MM-DD. */
export function isWithinRange(date: string, minDate: string, maxDate: string): boolean {
  return date >= minDate && date <= maxDate;
}

/** True when the month contains no selectable day at all. */
export function monthHasSelectableDay(
  monthKey: string,
  minDate: string,
  maxDate: string
): boolean {
  return monthKeyOf(minDate) <= monthKey && monthKey <= monthKeyOf(maxDate);
}

/** The month to open on: the selected day's, else the one holding minDate. */
export function initialMonthKey(selected: string, minDate: string): string {
  return monthKeyOf(selected || minDate);
}
