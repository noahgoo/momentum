import type { DistanceUnit, ExerciseMode, SetConfig, WeightUnit } from "@momentum/shared";

/** A blank set config for a freshly-added set, seeded with sane per-mode defaults. */
export function defaultSetConfig(
  mode: ExerciseMode,
  weightUnit: WeightUnit = "lbs",
  distanceUnit: DistanceUnit = "mi",
): SetConfig {
  if (mode === "time") return { seconds: 45, weightUnit };
  if (mode === "distance") return { distance: 1, distanceUnit };
  return { reps: 10, weightUnit };
}

/**
 * Converts a set of configs from one measure-by mode to another, mapping
 * only fields that carry over cleanly (weight/weightUnit/loadType survive
 * reps<->time; nothing carries into/out of distance, since pace and distance
 * have no reps or seconds analogue). Used when the coach flips a row's
 * "measure by" toggle.
 */
export function convertSetConfigs(
  configs: SetConfig[],
  fromMode: ExerciseMode,
  toMode: ExerciseMode,
): SetConfig[] {
  if (fromMode === toMode) return configs;
  return configs.map((cfg) => {
    const base = defaultSetConfig(toMode, cfg.weightUnit, cfg.distanceUnit);
    if (toMode === "distance") return base;
    if (fromMode === "distance") return base;
    // reps <-> time: carry weight/weightUnit forward, reset the prescription
    // value. weightDelta and loadType travel with the weight they modify.
    // perSide and maxEffort mean something in both ("30s each side", "hold
    // max" / "10 each side", "max reps"), so they carry too.
    return {
      ...base,
      weight: cfg.weight,
      weightUnit: cfg.weightUnit ?? base.weightUnit,
      ...(cfg.weightDelta !== undefined ? { weightDelta: cfg.weightDelta } : {}),
      ...(cfg.loadType !== undefined ? { loadType: cfg.loadType } : {}),
      ...(cfg.perSide ? { perSide: true } : {}),
      ...(cfg.maxEffort ? { maxEffort: true } : {}),
    };
  });
}

/** True when every set in a row still holds mode-appropriate default values (nothing entered yet). */
export function isUntouchedRow(mode: ExerciseMode, configs: SetConfig[]): boolean {
  return configs.every((cfg) => {
    const base = defaultSetConfig(mode, cfg.weightUnit, cfg.distanceUnit);
    if (mode === "time") return cfg.seconds === base.seconds && cfg.weight == null;
    if (mode === "distance") return cfg.distance === base.distance && cfg.paceSeconds == null;
    return cfg.reps === base.reps && cfg.weight == null;
  });
}
