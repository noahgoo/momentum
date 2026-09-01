/**
 * Free-text duration parsing/formatting for the workout builder's time
 * inputs (per-set seconds, rest seconds, estimated duration). Ported from
 * the old app's `lib/workoutSets.ts` — accepts "45" (seconds), "1:30"
 * (mm:ss), or "1:05:00" (hh:mm:ss); never produces NaN.
 */

/** Parses a free-text duration string into whole seconds, or undefined if unparseable/empty. */
export function parseDuration(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((p) => p.trim());
    if (parts.some((p) => p === "" || Number.isNaN(Number(p)))) return undefined;
    const nums = parts.map(Number);
    if (nums.length === 2) {
      const [m, s] = nums as [number, number];
      return m * 60 + s;
    }
    if (nums.length === 3) {
      const [h, m, s] = nums as [number, number, number];
      return h * 3600 + m * 60 + s;
    }
    return undefined;
  }

  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** Formats whole seconds as "m:ss" (or "h:mm:ss" past an hour). */
export function formatDuration(totalSeconds: number | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "";
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Formats a miles value compactly, e.g. `formatMiles(3)` -> "3 mi", `formatMiles(1.5)` -> "1.5 mi". */
export function formatMiles(miles: number | undefined): string {
  if (miles == null || !Number.isFinite(miles)) return "";
  const rounded = Math.round(miles * 100) / 100;
  return `${rounded} mi`;
}

/**
 * Parses the builder's free-text "estimated duration" field, which accepts
 * either a plain minute count ("45") or "h:mm" ("1:30" -> 90 minutes).
 * Returns whole minutes, or undefined if unparseable/empty.
 */
export function parseDurationMinutes(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((p) => p.trim());
    if (parts.length !== 2 || parts.some((p) => p === "" || Number.isNaN(Number(p)))) {
      return undefined;
    }
    const [h, m] = parts.map(Number) as [number, number];
    return h * 60 + m;
  }

  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** Formats whole minutes back into the builder's free-text duration field ("45" or "1:30"). */
export function formatDurationMinutes(totalMinutes: number | null | undefined): string {
  if (totalMinutes == null || !Number.isFinite(totalMinutes)) return "";
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return String(m);
  const hours = Math.floor(m / 60);
  const minutes = m % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/** Splits a comma-separated equipment tags string into a trimmed, de-duplicated array. */
export function parseEquipmentTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}
