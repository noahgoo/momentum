import { useState } from "react";
import type { Workout } from "@momentum/shared";
import {
  workoutExerciseTargetKey,
  type WorkoutExerciseTargetKey,
  type WorkoutLogWithSets,
} from "../../queries/useClientDetail";
import type { SetConfig } from "@momentum/shared";
import {
  computePace,
  DIFFICULTY_LABELS,
  DIFFICULTY_STYLES,
  formatLogDate,
  formatLogDuration,
  formatLogMiles,
  formatPace,
  formatTargetWeight,
} from "./logFormat";

interface Props {
  logs: WorkoutLogWithSets[];
  workoutsById: Map<string, Workout>;
  targetsByWorkoutExercise: Map<WorkoutExerciseTargetKey, SetConfig[]>;
}

const COLLAPSED_COUNT = 15;

/**
 * Ported from the old app's `src/components/coach/RecentWorkouts.tsx`.
 * Postgres-shape differences from the Firestore original:
 *  - exercises/sets are nested rows (`exercise_logs` -> `set_logs`), not
 *    embedded arrays on the log document — fetched via useClientDetail's
 *    `select("*, exercise_logs(*, set_logs(*)))")`.
 *  - per-set *targets* (what the old app read off `workout.exercises[i].setConfigs`)
 *    now come from `targetsByWorkoutExercise` (built in useClientDetail from
 *    `workout_exercises.set_configs`), looked up by workout+exercise id — a
 *    coach may have edited/reordered the workout since this log was
 *    recorded, so this is a best-effort match, not a guaranteed one (falls
 *    back to "—" targets if the workout_exercise row is gone).
 *  - mode is read off `exercise_logs.mode` (the log), not the current
 *    workout — the coach may have changed the exercise's mode since this
 *    session was recorded.
 */
export function RecentWorkouts({ logs, workoutsById, targetsByWorkoutExercise }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const completed = logs.filter((l) => l.completed);
  if (completed.length === 0) {
    return <p className="text-sm text-[var(--ink-30)]">No completed workouts yet.</p>;
  }
  const visible = showAll ? completed : completed.slice(0, COLLAPSED_COUNT);

  return (
    <div>
      {visible.map((log) => {
        const workout = log.workout_id ? workoutsById.get(log.workout_id) : undefined;
        const open = openId === log.id;
        const exerciseLogs = [...log.exercise_logs].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        );

        return (
          <div key={log.id} className="border-b border-[var(--ink-08)] last:border-0">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : log.id)}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
            >
              <div className="min-w-0">
                <span className="mr-2 text-xs text-[var(--ink-30)]">{formatLogDate(log.date)}</span>
                <span className="text-sm font-medium text-[var(--ink)]">{workout?.name ?? "Workout"}</span>
              </div>
              <div className="flex flex-none items-center gap-1.5">
                {log.warmup_completed && (
                  <span className="rounded-full bg-[var(--cream)] px-2 py-0.5 text-[11px] text-[var(--ok)]">
                    warm-up ✓
                  </span>
                )}
                {log.difficulty && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${DIFFICULTY_STYLES[log.difficulty]}`}
                  >
                    {DIFFICULTY_LABELS[log.difficulty]}
                  </span>
                )}
                {log.next_day_feel != null && (
                  <span className="rounded-full bg-[var(--cream)] px-2 py-0.5 text-[11px] text-[var(--ink-70)]">
                    Feel {log.next_day_feel}/5
                  </span>
                )}
                <span className={`text-[var(--ink-30)] transition-transform ${open ? "rotate-90" : ""}`}>
                  ›
                </span>
              </div>
            </button>

            {open && (
              <div className="space-y-3 pb-3">
                {exerciseLogs.map((ex) => {
                  const mode = ex.mode;
                  const sets = [...ex.set_logs].sort((a, b) => a.set_number - b.set_number);
                  const targets =
                    log.workout_id && ex.exercise_id
                      ? targetsByWorkoutExercise.get(workoutExerciseTargetKey(log.workout_id, ex.exercise_id))
                      : undefined;

                  return (
                    <div key={ex.id}>
                      <div className="mb-1 text-xs font-semibold text-[var(--ink-70)]">{ex.exercise_name}</div>
                      <table className="w-full max-w-sm text-xs text-[var(--ink-70)]">
                        <thead>
                          <tr className="text-left text-[10px] tracking-wide text-[var(--ink-30)] uppercase">
                            <th className="py-0.5 pr-3 font-medium">Set</th>
                            <th className="py-0.5 pr-3 font-medium">
                              {mode === "distance" ? "Distance" : "Target"}
                            </th>
                            <th className="py-0.5 pr-3 font-medium">
                              {mode === "distance" ? "Time" : "Actual"}
                            </th>
                            <th className="py-0.5 pr-3 font-medium">
                              {mode === "time" ? "Time" : mode === "distance" ? "Pace" : "Reps"}
                            </th>
                            <th className="py-0.5 font-medium" />
                          </tr>
                        </thead>
                        <tbody>
                          {sets.map((set, i) => (
                            <tr key={set.id}>
                              <td className="py-0.5 pr-3">{set.set_number}</td>
                              <td className="py-0.5 pr-3">
                                {mode === "distance"
                                  ? formatLogMiles(set.actual_miles)
                                  : formatTargetWeight(targets?.[i])}
                              </td>
                              <td className="py-0.5 pr-3">
                                {mode === "distance"
                                  ? formatLogDuration(set.actual_seconds)
                                  : set.weight != null
                                    ? `${set.weight}${set.weight_unit === "kg" ? " kg" : ""}`
                                    : "—"}
                              </td>
                              <td className="py-0.5 pr-3">
                                {mode === "time"
                                  ? formatLogDuration(set.target_seconds)
                                  : mode === "distance"
                                    ? (() => {
                                        const pace = computePace(set.actual_miles, set.actual_seconds);
                                        return pace != null ? `${formatPace(pace)}/mi` : "—";
                                      })()
                                    : (set.reps ?? "—")}
                              </td>
                              <td className={`py-0.5 ${set.completed ? "text-[var(--ok)]" : "text-[var(--ink-15)]"}`}>
                                {set.completed ? "✓" : "✗"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {completed.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs font-medium text-[var(--blue-deep)] hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${completed.length}`}
        </button>
      )}
    </div>
  );
}
