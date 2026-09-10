import { useMemo } from "react";
import { useNavigate } from "react-router";
import type { WorkoutType } from "@momentum/shared";
import { useDeleteWorkout, useDuplicateWorkout, useWorkoutExerciseCounts, useWorkouts, WorkoutInUseError } from "../queries/useWorkouts";

export interface WorkoutsPageProps {
  /** "warmup" renders the Warmups list (same component, filtered + relabeled). */
  type?: WorkoutType;
}

/**
 * Lists the coach's workouts (or warmups, via `type="warmup"`): name,
 * exercise count, duration, and edit/duplicate/delete actions. Shared by
 * the /library/workouts and /library/warmups routes, which differ only in
 * the `type` they pass.
 */
export function WorkoutsPage({ type = "workout" }: WorkoutsPageProps) {
  const navigate = useNavigate();
  const isWarmup = type === "warmup";
  const noun = isWarmup ? "warmup" : "workout";
  const basePath = isWarmup ? "/library/warmups" : "/library/workouts";

  const { data: workouts = [], isLoading } = useWorkouts(type);
  const workoutIds = useMemo(() => workouts.map((w) => w.id), [workouts]);
  const { data: exerciseCounts = {} } = useWorkoutExerciseCounts(workoutIds);
  const deleteWorkout = useDeleteWorkout(type);
  const duplicateWorkout = useDuplicateWorkout(type);

  async function handleDelete(id: string, name: string) {
    const ok = window.confirm(`Delete "${name}"? This removes all its exercises too. This can't be undone.`);
    if (!ok) return;
    try {
      await deleteWorkout.mutateAsync(id);
    } catch (error) {
      window.alert(
        error instanceof WorkoutInUseError
          ? `${error.message} Remove it from those programs before deleting it.`
          : `Could not delete "${name}". Please try again.`
      );
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-[var(--ink-50)]">
          {isLoading ? "Loading…" : `${workouts.length} ${noun}${workouts.length === 1 ? "" : "s"}`}
        </p>
        <button
          type="button"
          onClick={() => navigate(`${basePath}/new`)}
          className="admin-primary px-4 py-2.5 text-sm"
        >
          New {noun}
        </button>
      </div>

      {isLoading && <p className="text-sm text-[var(--ink-30)]">Loading…</p>}

      {!isLoading && workouts.length === 0 && (
        <div className="admin-card p-8 text-center text-sm text-[var(--ink-30)]">
          No {noun}s yet. Create your first one to get started.
        </div>
      )}

      {!isLoading && workouts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workouts.map((workout) => (
            <div key={workout.id} className="admin-card flex flex-col p-5">
              <h2 className="truncate font-display text-lg text-[var(--ink)]">{workout.name}</h2>
              {workout.description && (
                <p className="mt-1 line-clamp-2 text-sm text-[var(--ink-50)]">{workout.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-50)]">
                <span>{exerciseCounts[workout.id] ?? 0} exercises</span>
                {workout.estimated_duration_minutes != null && (
                  <>
                    <span>·</span>
                    <span>{workout.estimated_duration_minutes} min</span>
                  </>
                )}
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-[var(--ink-08)] pt-4">
                <button
                  type="button"
                  onClick={() => navigate(`${basePath}/${workout.id}`)}
                  className="flex-1 admin-secondary px-3 py-1.5 text-xs"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void duplicateWorkout.mutateAsync(workout.id)}
                  disabled={duplicateWorkout.isPending}
                  className="admin-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(workout.id, workout.name)}
                  disabled={deleteWorkout.isPending}
                  className="rounded-lg border border-[var(--ink-08)] px-3 py-1.5 text-xs font-medium text-[var(--bad)] hover:bg-red-50 disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
