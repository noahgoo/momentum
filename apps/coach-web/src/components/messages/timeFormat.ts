/**
 * Small time-formatting helpers shared by ThreadList and MessageThread.
 * Ported from the old app's `admin/messages/page.tsx` (relativeTime/
 * formatTime) — dates here are always plain ISO timestamps from Postgres
 * (`timestamptz`), never Firestore Timestamps, so no `toDate()` shim needed.
 */

/** "just now" / "5m" / "3h" / "Tue" — used for the thread list's timestamp. */
export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short" });
}

/** "2:45 PM" — used under each message bubble. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Tuesday, March 4" / "Today" / "Yesterday" — used for day separators. */
export function formatDaySeparator(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** Calendar-day key (local time) for grouping messages into day separators. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
