import type { DistanceUnit, ExerciseMode, LoadType, SetConfig, WeightUnit } from "./domain.js";

/**
 * Display-formatting helpers for workout targets and results, shared by the
 * mobile logger/history and the coach's client view so the two can never word
 * the same number differently. Ported from the old app's
 * `mindful-miya/src/lib/workoutSets.ts`.
 *
 * Everything here is pure and reads only the config or log row it is handed:
 * history passes a set's own `prescribed` snapshot (P1), never a live join.
 * This is the one place a config becomes words (P7).
 */

const LOAD_TYPE_LABEL: Record<LoadType, string> = {
  total: "TOTAL WEIGHT",
  each_hand: "EACH HAND",
  bodyweight: "BODYWEIGHT",
  bodyweight_plus: "+ BODYWEIGHT",
  assisted: "ASSISTED",
};

/** Short unit text shown next to every weight: "lb" or "kg". */
export function weightUnitLabel(unit: WeightUnit | null | undefined): string {
  return unit === "kg" ? "kg" : "lb";
}

/** Short unit text for a distance: "mi" or "km". */
export function distanceUnitLabel(unit: DistanceUnit | null | undefined): string {
  return unit === "km" ? "km" : "mi";
}

/**
 * Display string for prescribed target reps, e.g. "10", "10 /side" or "Max".
 *
 * `??` not `||`: a prescription of 0 reps is a real instruction (a skipped or
 * deliberately-empty set) and must not collapse into an em dash (P5). A set
 * with no reps but `maxEffort` is not missing data either — it means "as many
 * as you can".
 */
export function formatTargetReps(cfg: SetConfig | undefined): string {
  if (cfg?.reps == null) return cfg?.maxEffort ? "Max" : "—";
  return cfg.perSide ? `${cfg.reps} /side` : `${cfg.reps}`;
}

/**
 * A weight with its unit, e.g. "135 lb" or "60 kg". A weight with no recorded
 * unit (old rows) shows bare rather than guessing one (P6). Nullish -> "—".
 */
export function formatWeight(weight: number | undefined | null, unit: WeightUnit | null | undefined): string {
  if (weight == null || !Number.isFinite(weight)) return "—";
  return unit ? `${weight} ${weightUnitLabel(unit)}` : `${weight}`;
}

/** Display string for a coach-prescribed target weight, e.g. "135 lb". Bodyweight reads as such, not "—". */
export function formatTargetWeight(cfg: SetConfig | undefined): string {
  if (cfg?.loadType === "bodyweight" && cfg.weight == null) return "BW";
  return formatWeight(cfg?.weight, cfg?.weightUnit);
}

/** The pill text for a load type, or null when the set doesn't say. */
export function loadTypeLabel(loadType: LoadType | undefined): string | null {
  return loadType ? LOAD_TYPE_LABEL[loadType] : null;
}

/**
 * Pills for an exercise header, derived from its sets: what the weight means,
 * whether the work is per side, whether the target is "max". Authored per
 * exercise but stored per set, so any set carrying the flag raises the pill.
 */
export function exerciseBadges(configs: (SetConfig | undefined)[]): string[] {
  const badges: string[] = [];
  const load = configs.find((c) => c?.loadType)?.loadType;
  const label = loadTypeLabel(load);
  if (label) badges.push(label);
  if (configs.some((c) => c?.perSide)) badges.push("EACH SIDE");
  if (configs.some((c) => c?.maxEffort)) badges.push("MAX");
  return badges;
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

/** Seconds-per-distance-unit -> "8:30". Pair with `paceSuffix` for the unit. */
export function formatPace(secondsPerUnit: number | undefined | null): string {
  if (secondsPerUnit == null || !Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) {
    return "—";
  }
  const total = Math.round(secondsPerUnit);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** "/mi" or "/km" — the unit a pace is measured per. */
export function paceSuffix(unit: DistanceUnit | null | undefined): string {
  return `/${distanceUnitLabel(unit)}`;
}

/** A distance with its unit: "3 mi", "5.25 km". Nullish renders as an em dash. */
export function formatDistance(distance: number | undefined | null, unit: DistanceUnit | null | undefined): string {
  if (distance == null || !Number.isFinite(distance) || distance < 0) return "—";
  const rounded = Math.round(distance * 100) / 100;
  return `${rounded} ${distanceUnitLabel(unit)}`;
}

/** Derived pace in seconds per distance unit. Undefined when the inputs can't produce one. */
export function computePace(
  distance: number | undefined | null,
  seconds: number | undefined | null
): number | undefined {
  if (distance == null || seconds == null) return undefined;
  if (!Number.isFinite(distance) || !Number.isFinite(seconds)) return undefined;
  if (distance <= 0 || seconds <= 0) return undefined;
  const pace = seconds / distance;
  return Number.isFinite(pace) ? pace : undefined;
}

/** What the client sees where reps normally go: "10", "0:45", or "3 mi". */
export function formatPrescription(mode: "reps" | "time" | "distance", cfg: SetConfig | undefined): string {
  if (!cfg) return "—";
  if (mode === "time") return cfg.seconds == null && cfg.maxEffort ? "Max" : formatDuration(cfg.seconds);
  if (mode === "distance") return formatDistance(cfg.distance, cfg.distanceUnit);
  return formatTargetReps(cfg);
}

/**
 * One-line plain-English target for a set, e.g. "10 reps × 25 lb each hand",
 * "0:45 each side", "3 mi @ 8:30/mi", "Max reps". Reads only the config it is
 * given, so history passes the snapshot and the live logger passes the
 * resolved target — never a fresh join (P1).
 */
export function describeTarget(mode: "reps" | "time" | "distance", cfg: SetConfig | undefined): string {
  if (!cfg) return "—";
  if (mode === "distance") {
    const dist = formatDistance(cfg.distance, cfg.distanceUnit);
    return cfg.paceSeconds != null
      ? `${dist} @ ${formatPace(cfg.paceSeconds)}${paceSuffix(cfg.distanceUnit)}`
      : dist;
  }
  const side = cfg.perSide ? " each side" : "";
  if (mode === "time") {
    return cfg.seconds == null
      ? cfg.maxEffort
        ? `Hold max${side}`
        : "—"
      : `${formatDuration(cfg.seconds)}${side}`;
  }
  const reps = cfg.reps == null ? (cfg.maxEffort ? "Max reps" : null) : `${cfg.reps} ${cfg.reps === 1 ? "rep" : "reps"}`;
  if (reps == null) return "—";
  if (cfg.loadType === "bodyweight") return `${reps}${side}`;
  const load = cfg.weight == null ? "" : ` × ${formatWeight(cfg.weight, cfg.weightUnit)}`;
  const hand = cfg.loadType === "each_hand" && cfg.weight != null ? " each hand" : "";
  const plus =
    cfg.weight != null && cfg.loadType === "bodyweight_plus"
      ? ` × BW + ${formatWeight(cfg.weight, cfg.weightUnit)}`
      : cfg.weight != null && cfg.loadType === "assisted"
        ? ` × assisted ${formatWeight(cfg.weight, cfg.weightUnit)}`
        : null;
  return `${reps}${plus ?? load}${hand}${side}`;
}

/**
 * Parses what a client typed into a number. Accepts a comma or a dot as the
 * decimal mark (phone keyboards in some locales only offer a comma) and
 * returns undefined — never NaN — for anything incomplete like "." or "1.2.3",
 * so a half-typed value can't reach Supabase (P5).
 */
export function parseDecimal(input: string): number | undefined {
  const t = input.trim().replace(",", ".");
  if (t === "" || !/^\d*\.?\d*$/.test(t) || t === ".") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Digit-shift duration entry, like a kitchen timer: digits fill in from the
 * right, so typing 2-4-3-0 reads 0:02 → 0:24 → 2:43 → 24:30. There is no
 * ambiguity about whether "30" means seconds or minutes — it is 0:30, and a
 * 30-minute run is typed 3-0-0-0. Keeps at most six digits (H:MM:SS).
 */
export function digitsFromText(text: string): string {
  return text.replace(/\D/g, "").replace(/^0+/, "").slice(-6);
}

/** Masks a digit string as "0:30", "24:30" or "1:30:00". Empty stays empty. */
export function maskDigits(digits: string): string {
  if (digits === "") return "";
  const n = digits.padStart(3, "0");
  const secs = n.slice(-2);
  const rest = n.slice(0, -2);
  if (rest.length <= 2) return `${Number(rest)}:${secs}`;
  return `${rest.slice(0, -2)}:${rest.slice(-2)}:${secs}`;
}

/** Seconds a digit string represents. Undefined for empty. */
export function secondsFromDigits(digits: string): number | undefined {
  if (digits === "") return undefined;
  const n = digits.padStart(6, "0");
  return Number(n.slice(0, 2)) * 3600 + Number(n.slice(2, 4)) * 60 + Number(n.slice(4, 6));
}

/**
 * The digit string for stored seconds (inverse of secondsFromDigits). Zero
 * seconds is the same as nothing entered here: a zero-length effort isn't a
 * result worth showing, and a leading-zero-free digit string can't hold it.
 */
export function digitsFromSeconds(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return String(h * 10000 + m * 100 + s);
}

/** The log-row fields `describeResult` reads. Structural, so mobile and coach-web rows both fit. */
export interface SetResultFields {
  reps: number | null;
  weight: number | null;
  weight_unit: WeightUnit | null;
  actual_seconds: number | null;
  actual_distance: number | null;
  distance_unit: DistanceUnit | null;
}

/**
 * What the client did on a set, in the units it was logged in. Reads only the
 * log row (P4: mode and units come from the log, not the live workout). An
 * unfinished set shows an em dash, never a 0 it didn't record (P5).
 */
export function describeResult(mode: ExerciseMode, set: SetResultFields): string {
  if (mode === "time") return formatDuration(set.actual_seconds);
  if (mode === "distance") {
    if (set.actual_distance == null) return "—";
    const pace = computePace(set.actual_distance, set.actual_seconds);
    const parts = [formatDistance(set.actual_distance, set.distance_unit)];
    if (set.actual_seconds != null) parts.push(formatDuration(set.actual_seconds));
    if (pace != null) parts.push(`${formatPace(pace)}${paceSuffix(set.distance_unit)}`);
    return parts.join(" · ");
  }
  if (set.reps == null && set.weight == null) return "—";
  const reps = set.reps != null ? `${set.reps}` : "—";
  return set.weight != null ? `${reps} × ${formatWeight(set.weight, set.weight_unit)}` : `${reps} reps`;
}
