import type { SetConfig, WorkoutDifficulty } from "@momentum/shared";

/**
 * Display-formatting helpers for RecentWorkouts' per-set target/actual
 * tables. Ported from apps/mobile/components/workout/format.ts (itself from
 * the old app's `lib/workoutSets.ts`) rather than reusing coach-web's
 * `lib/workoutFormat.ts` — that file's `formatDuration`/`formatMiles` are
 * shaped for the workout builder's free-text inputs (no em-dash fallback,
 * different rounding/parsing contract) and changing their behavior here
 * would risk the builder. Kept file-local since RecentWorkouts is this
 * panel's only consumer.
 */

/**
 * Display string for prescribed target reps, e.g. "10" or "10 /side".
 * `??` not `||`: a prescribed 0 is real and must not become an em dash (P5).
 */
export function formatTargetReps(cfg: SetConfig | undefined): string {
  if (cfg?.reps == null) return "—";
  return cfg.perSide ? `${cfg.reps} /side` : `${cfg.reps}`;
}

/** Display string for a coach-prescribed target weight, e.g. "135" or "60 kg". */
export function formatTargetWeight(cfg: SetConfig | undefined): string {
  if (cfg?.weight == null) return "—";
  return cfg.weightUnit === "kg" ? `${cfg.weight} kg` : `${cfg.weight}`;
}

/** Seconds -> "45s", "1:30", or "1:05:00". Nullish input renders as an em dash. */
export function formatLogDuration(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
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
export function formatLogMiles(miles: number | undefined | null): string {
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

export const DIFFICULTY_LABELS: Record<WorkoutDifficulty, string> = {
  too_easy: "Too easy",
  challenging: "Challenging",
  overly_challenging: "Overly challenging",
};

export const DIFFICULTY_STYLES: Record<WorkoutDifficulty, string> = {
  too_easy: "bg-[var(--cream)] text-[var(--blue-deep)]",
  challenging: "bg-[var(--cream)] text-[var(--ok)]",
  overly_challenging: "bg-red-50 text-red-700",
};

/** Formats a YYYY-MM-DD log date string as-is (constraint #11 — no tz round-trip). */
export function formatLogDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
