import type { WorkoutDifficulty } from "@momentum/shared";

/** Coach client-view display constants. Target/result wording lives in @momentum/shared (workoutFormat.ts). */

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
