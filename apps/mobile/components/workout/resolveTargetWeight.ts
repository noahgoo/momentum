import type { SetConfig, WeightUnit } from "@momentum/shared";

/** One prior set's logged weight, as it arrives in `last_set_weights`. */
export interface LastSetWeight {
  weight: number;
  weight_unit: WeightUnit | null;
}

/**
 * `last_set_weights` from get_workout_day:
 * `{ exercise_id: { set_number: { weight, weight_unit } } }`.
 *
 * Keyed by set NUMBER rather than array position, so a coach inserting or
 * deleting a set cannot silently reassign every target (P3).
 */
export type LastSetWeights = Record<string, Record<string, LastSetWeight>>;

/**
 * Turns a coach's prescription into the concrete target the client sees.
 *
 * TAKES A LIVE `set_configs` ENTRY ONLY. A `set_logs.prescribed` snapshot is
 * already resolved — running this over one would resolve a second time, off a
 * newer prior. History renders through `formatTargetWeight`, which reads
 * `weight` directly and never calls this.
 *
 * `weightDelta` present means "last logged weight + delta" and WINS over
 * `weight`, which stays untouched underneath so the builder's toggle is
 * lossless. Absent means the fixed `weight` is the target.
 */
export function resolveTargetWeight(
  cfg: SetConfig,
  lastForSet: LastSetWeight | undefined
): { weight?: number; weightUnit?: WeightUnit } {
  // Fixed target: pass the coach's number straight through.
  if (cfg.weightDelta === undefined) {
    return { weight: cfg.weight, weightUnit: cfg.weightUnit };
  }

  // No prior to build on — the target stays BLANK rather than falling back to
  // the fixed weight or to zero. "Nothing to progress from yet" is honest;
  // a number here would be invented. Renders as "—" (P5).
  if (!lastForSet || lastForSet.weight == null) {
    return { weightUnit: cfg.weightUnit };
  }

  // P6: never aggregate two weights without checking their units match.
  // Converting would mean inventing a rounding rule (2.2 lb/kg) the coach
  // never chose, and silently changing the number they authored.
  if (cfg.weightUnit !== lastForSet.weight_unit) {
    return { weightUnit: cfg.weightUnit };
  }

  // Clamp at 0: a -10 deload off a 5 lb prior would otherwise produce a
  // negative target, which setConfigSchema's `weight: nonnegative()` rejects.
  const resolved = Math.max(0, lastForSet.weight + cfg.weightDelta);
  return { weight: resolved, weightUnit: cfg.weightUnit };
}

/**
 * The resolved config to snapshot onto a set log. Carries the concrete weight
 * AND keeps `weightDelta` as provenance, so history can say "this was a +5
 * progression" rather than just showing a number (P1).
 */
export function resolvedSetConfig(
  cfg: SetConfig,
  lastForSet: LastSetWeight | undefined
): SetConfig {
  const { weight, weightUnit } = resolveTargetWeight(cfg, lastForSet);
  const out: SetConfig = { ...cfg };
  if (weight === undefined) delete out.weight;
  else out.weight = weight;
  if (weightUnit === undefined) delete out.weightUnit;
  else out.weightUnit = weightUnit;
  return out;
}

/** This exercise's prior weights, keyed by set number. */
export function lastWeightsForExercise(
  lastSetWeights: LastSetWeights | undefined,
  exerciseId: string | null
): Record<string, LastSetWeight> | undefined {
  if (!lastSetWeights || !exerciseId) return undefined;
  return lastSetWeights[exerciseId];
}
