/**
 * Timezone-aware calendar dates.
 *
 * A workout belongs to a calendar DAY, not a moment — so every date in this
 * app is a local calendar date in the CLIENT's timezone (`profiles.timezone`,
 * device-synced). SQL resolves this through `client_today(client_id)`; these
 * helpers are the application-side counterpart, and they must agree with it.
 *
 * Do NOT use `dateStr(new Date())` to mean "today": that is the *device*
 * clock, which is a different thing — it drifts while travelling before the
 * timezone sync lands, and on coach-web it is the coach's date, not the
 * client's. See docs/rules/concurrency.md C1.
 */

/** Fallback when a profile has no timezone yet — matches SQL's `client_today` default. */
export const DEFAULT_TIMEZONE = "America/New_York";

/**
 * `Intl.DateTimeFormat` with the `en-CA` locale emits `YYYY-MM-DD` directly,
 * which is exactly our wire format — no manual padding or reordering.
 * Formatters are expensive to construct, so they're cached per timezone.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // Unknown/invalid IANA zone (a stale or corrupt profiles.timezone).
    // Fall back rather than throwing — a wrong-by-an-hour date is far better
    // than a crashed screen.
    formatter =
      timeZone === DEFAULT_TIMEZONE
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
        : getFormatter(DEFAULT_TIMEZONE);
  }

  formatterCache.set(timeZone, formatter);
  return formatter;
}

/**
 * The calendar date at `at` as seen in `timezone`, as YYYY-MM-DD.
 * Pass a client's `profiles.timezone`; nullish falls back to DEFAULT_TIMEZONE.
 */
export function clientDateStr(timezone: string | null | undefined, at: Date = new Date()): string {
  return getFormatter(timezone ?? DEFAULT_TIMEZONE).format(at);
}

/** Today's calendar date in `timezone`, as YYYY-MM-DD. The app-side `client_today()`. */
export function clientToday(timezone: string | null | undefined): string {
  return clientDateStr(timezone);
}

/** Whether two instants fall on the same calendar day in `timezone`. */
export function isSameClientDay(
  timezone: string | null | undefined,
  a: Date,
  b: Date
): boolean {
  return clientDateStr(timezone, a) === clientDateStr(timezone, b);
}

/**
 * Shifts a YYYY-MM-DD calendar date by whole days, staying in calendar space.
 * Timezone-independent: it never converts to an instant, so it can't be
 * pushed across a boundary by a DST shift.
 */
export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  // Date.UTC avoids any local-timezone interpretation of the intermediate value.
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * The Monday of the week containing `dateStr`, as YYYY-MM-DD.
 * Pure calendar arithmetic — no instant, so no timezone can shift it.
 */
export function mondayOfStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay(); // 0 = Sunday
  return addDaysStr(dateStr, day === 0 ? -6 : 1 - day);
}
