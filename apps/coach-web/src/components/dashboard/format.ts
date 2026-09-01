/** First letter of a display name, uppercased, for the avatar circle. Falls back to "?". */
export function avatarInitial(name: string | null): string {
  return name?.trim()[0]?.toUpperCase() ?? "?";
}

/** Coarse "Xm/h/d ago" relative time for the last-message footer. */
export function formatRelative(iso: string | null): string {
  if (!iso) return "No messages yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No messages yet";

  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
