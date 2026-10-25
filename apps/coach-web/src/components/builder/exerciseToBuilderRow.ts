import type { DistanceUnit, Exercise, SetConfig, WeightUnit } from "@momentum/shared";
import type { BuilderExercise } from "../../queries/useWorkoutDetail";
import { defaultSetConfig } from "./defaultSetConfig";

/**
 * A new builder row for a library exercise, seeded from the exercise's
 * defaults: sets/reps/duration/distance, plus what a weight on it means
 * (`default_load_type`, e.g. each_hand for a dumbbell row) and the unit the
 * distance is in. `id` is the row's drag identity — callers pick its shape.
 *
 * `units` is the client's own preference when the day is being built for one
 * client; it wins over the exercise's default, since it is the more specific
 * fact. A library workout has no client, so it passes none.
 */
export function exerciseToBuilderRow(
  ex: Exercise,
  id: string,
  units?: { weightUnit?: WeightUnit; distanceUnit?: DistanceUnit },
): BuilderExercise {
  const weightUnit = units?.weightUnit ?? "lbs";
  const distanceUnit = units?.distanceUnit ?? ex.default_distance_unit ?? "mi";
  const mode = ex.default_mode ?? "reps";
  const setCount = mode === "distance" ? 1 : Math.max(ex.default_sets || 3, 1);
  const loadType = ex.default_load_type ?? undefined;

  const config: SetConfig =
    mode === "time"
      ? { ...defaultSetConfig(mode, weightUnit), seconds: ex.default_duration_seconds ?? 45 }
      : mode === "distance"
        ? {
            ...defaultSetConfig(mode, weightUnit, distanceUnit),
            distance: ex.default_distance ?? 1,
          }
        : { ...defaultSetConfig(mode, weightUnit), reps: ex.default_reps ?? 10 };
  if (loadType && mode !== "distance") config.loadType = loadType;

  return {
    id,
    exerciseId: ex.id,
    exerciseName: ex.name,
    mode,
    setConfigs: Array.from({ length: setCount }, () => ({ ...config })),
    restSeconds: 60,
    notes: null,
  };
}
