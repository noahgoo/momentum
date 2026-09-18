import type { ExerciseMode, SetConfig, WeightUnit } from "@momentum/shared";

/** A blank set config for a freshly-added set, seeded with sane per-mode defaults. */
export function defaultSetConfig(mode: ExerciseMode, weightUnit: WeightUnit = "lbs"): SetConfig {
  if (mode === "time") return { seconds: 45 };
  if (mode === "distance") return { miles: 1 };
  return { reps: 10, weightUnit };
}

/**
 * Converts a set of configs from one measure-by mode to another, mapping
 * only fields that carry over cleanly (weight/weightUnit survive reps<->time;
 * nothing carries into/out of distance, since pace and miles have no reps or
 * seconds analogue). Used when the coach flips a row's "measure by" toggle.
 */
export function convertSetConfigs(
  configs: SetConfig[],
  fromMode: ExerciseMode,
  toMode: ExerciseMode,
): SetConfig[] {
  if (fromMode === toMode) return configs;
  return configs.map((cfg) => {
    const base = defaultSetConfig(toMode, cfg.weightUnit);
    if (toMode === "distance") return base;
    if (fromMode === "distance") return base;
    // reps <-> time: carry weight/weightUnit forward, reset the prescription
    // value. weightDelta travels with the weight it modifies; perSide does NOT
    // — "10 reps each side" has no meaning as a duration, and leaving it set
    // would print "/side" next to a stopwatch.
    return {
      ...base,
      weight: cfg.weight,
      weightUnit: cfg.weightUnit ?? base.weightUnit,
      ...(cfg.weightDelta !== undefined ? { weightDelta: cfg.weightDelta } : {}),
      ...(toMode === "reps" && cfg.perSide ? { perSide: true } : {}),
    };
  });
}

/** True when every set in a row still holds mode-appropriate default values (nothing entered yet). */
export function isUntouchedRow(mode: ExerciseMode, configs: SetConfig[]): boolean {
  return configs.every((cfg) => {
    const base = defaultSetConfig(mode, cfg.weightUnit);
    if (mode === "time") return cfg.seconds === base.seconds && cfg.weight == null;
    if (mode === "distance") return cfg.miles === base.miles && cfg.paceSeconds == null;
    return cfg.reps === base.reps && cfg.weight == null;
  });
}
