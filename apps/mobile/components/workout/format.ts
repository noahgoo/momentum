import type { SetConfig } from "@momentum/shared";

/**
 * Display-formatting helpers for the workout logger/history, ported from the
 * old app's `mindful-miya/src/lib/workoutSets.ts`. Kept app-local (not
 * packages/shared) — these are pure display strings, not domain logic other
 * slices need.
 */

/** Display string for a coach-prescribed target weight, e.g. "135" or "60 kg". */
export function formatTargetWeight(cfg: SetConfig | undefined): string {
  if (cfg?.weight == null) return "—";
  return cfg.weightUnit === "kg" ? `${cfg.weight} kg` : `${cfg.weight}`;
}

/** Seconds -> "45s", "1:30", or "1:05:00". Nullish input renders as an em dash. */
export function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/**
 * Parse "45", "1:30" or "1:05:00" into seconds. Returns undefined — never
 * NaN — for anything unparseable, so partial typing never reaches Supabase.
 */
export function parseDuration(input: string): number | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;

  const trailingColon = trimmed.endsWith(":");
  const parts = trimmed.split(":");
  if (parts.length > 3) return undefined;

  if (parts[0]?.trim() === "") return undefined;
  const hasEmpty = parts.some((p) => p.trim() === "");
  if (hasEmpty && !(trailingColon && parts.length === 2 && parts[1]?.trim() === "")) {
    return undefined;
  }

  let total = 0;
  for (const part of parts) {
    const t = part.trim();
    if (t !== "" && !/^\d+$/.test(t)) return undefined;
    const n = t === "" ? 0 : Number(t);
    if (!Number.isFinite(n)) return undefined;
    total = total * 60 + n;
  }
  return total;
}

/** Seconds-per-mile -> "8:30". */
export function formatPace(secondsPerMile: number | undefined | null): string {
  if (secondsPerMile == null || !Number.isFinite(secondsPerMile) || secondsPerMile <= 0) {
    return "—";
  }
  const total = Math.round(secondsPerMile);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Miles -> "3 mi" / "3.5 mi". Nullish renders as an em dash. */
export function formatMiles(miles: number | undefined | null): string {
  if (miles == null || !Number.isFinite(miles) || miles < 0) return "—";
  const rounded = Math.round(miles * 100) / 100;
  return `${rounded} mi`;
}

/** Derived pace in seconds per mile. Undefined when the inputs can't produce one. */
export function computePace(
  miles: number | undefined | null,
  seconds: number | undefined | null
): number | undefined {
  if (miles == null || seconds == null) return undefined;
  if (!Number.isFinite(miles) || !Number.isFinite(seconds)) return undefined;
  if (miles <= 0 || seconds <= 0) return undefined;
  const pace = seconds / miles;
  return Number.isFinite(pace) ? pace : undefined;
}

/** What the client sees where reps normally go: "10", "0:45", or "3 mi". */
export function formatPrescription(mode: "reps" | "time" | "distance", cfg: SetConfig | undefined): string {
  if (!cfg) return "—";
  if (mode === "time") return formatDuration(cfg.seconds);
  if (mode === "distance") return formatMiles(cfg.miles);
  return cfg.reps != null ? `${cfg.reps}` : "—";
}
