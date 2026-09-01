import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Exercise, SetConfig, WorkoutType } from "@momentum/shared";
import { workoutCreateSchema } from "@momentum/shared";
import { useAuth } from "../lib/auth";
import { SortableList } from "../components/builder/SortableList";
import { ExerciseRow } from "../components/builder/ExerciseRow";
import { defaultSetConfig } from "../components/builder/defaultSetConfig";
import { ExerciseLibraryPanel } from "../components/exercises/ExerciseLibraryPanel";
import { useExercises } from "../queries/useExercises";
import { useWorkouts } from "../queries/useWorkouts";
import { useSaveWorkout, useWorkoutDetail, type BuilderExercise } from "../queries/useWorkoutDetail";
import { parseDurationMinutes, formatDurationMinutes, parseEquipmentTags } from "../lib/workoutFormat";

export interface WorkoutBuilderPageProps {
  /** "warmup" builds/edits a warmup instead of a workout (hides the warmup-selector field). */
  type?: WorkoutType;
}

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function exerciseToBuilderRow(ex: Exercise): BuilderExercise {
  const mode = ex.default_mode ?? "reps";
  const setCount = mode === "distance" ? 1 : Math.max(ex.default_sets || 3, 1);
  const config: SetConfig =
    mode === "time"
      ? { ...defaultSetConfig(mode), seconds: ex.default_duration_seconds ?? 45 }
      : mode === "distance"
        ? { ...defaultSetConfig(mode), miles: ex.default_miles ?? 1 }
        : { ...defaultSetConfig(mode), reps: ex.default_reps ?? 10 };

  return {
    id: newClientId(),
    exerciseId: ex.id,
    exerciseName: ex.name,
    mode,
    setConfigs: Array.from({ length: setCount }, () => ({ ...config })),
    restSeconds: 60,
    notes: null,
  };
}

/**
 * Workout builder (new + edit). Left panel: sortable exercise list. Right
 * panel: exercise library. Sticky bottom bar shows live exercise
 * count/duration + validation hints and saves.
 */
export function WorkoutBuilderPage({ type = "workout" }: WorkoutBuilderPageProps) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const isWarmup = type === "warmup";
  const noun = isWarmup ? "warmup" : "workout";
  const basePath = isWarmup ? "/warmups" : "/workouts";
  const workoutId = params.id;
  const isEditing = !!workoutId;

  const { data: detail, isLoading: detailLoading } = useWorkoutDetail(workoutId);
  const { data: warmupOptions = [] } = useWorkouts("warmup");
  const { data: libraryExercises = [] } = useExercises();
  const saveWorkout = useSaveWorkout();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationStr, setDurationStr] = useState("");
  const [equipmentStr, setEquipmentStr] = useState("");
  const [warmupId, setWarmupId] = useState<string>("");
  const [exercises, setExercises] = useState<BuilderExercise[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [hydrated, setHydrated] = useState(!isEditing);

  // Hydrate form state once the workout detail AND the exercise library have
  // loaded (edit mode only) — the library is needed to resolve each row's
  // exercise_id back to a display name, since workout_exercises only stores
  // the FK, not a denormalized name.
  useEffect(() => {
    if (!isEditing || !detail || hydrated || libraryExercises.length === 0) return;
    const nameById = new Map(libraryExercises.map((ex) => [ex.id, ex.name]));
    setName(detail.name);
    setDescription(detail.description ?? "");
    setDurationStr(formatDurationMinutes(detail.estimatedDurationMinutes));
    setEquipmentStr(detail.equipment.join(", "));
    setWarmupId(detail.warmupId ?? "");
    setExercises(
      detail.exercises.map((ex) => ({
        id: ex.id,
        exerciseId: ex.exerciseId,
        exerciseName: (ex.exerciseId && nameById.get(ex.exerciseId)) || "Deleted exercise",
        mode: ex.mode,
        setConfigs: ex.setConfigs,
        restSeconds: ex.restSeconds,
        notes: ex.notes,
      })),
    );
    setHydrated(true);
  }, [isEditing, detail, hydrated, libraryExercises]);

  function addExercise(ex: Exercise) {
    setExercises((prev) => [...prev, exerciseToBuilderRow(ex)]);
  }

  const equipment = useMemo(() => parseEquipmentTags(equipmentStr), [equipmentStr]);
  const estimatedDurationMinutes = useMemo(() => parseDurationMinutes(durationStr), [durationStr]);

  const totalSets = exercises.reduce((sum, ex) => sum + ex.setConfigs.length, 0);
  const estimatedFromSets =
    exercises.reduce((sum, ex) => {
      const restPerSet = ex.restSeconds ?? 60;
      return sum + ex.setConfigs.length * (restPerSet + 45);
    }, 0) / 60;

  const validationErrors: string[] = [];
  if (!name.trim()) validationErrors.push("Name is required.");
  if (exercises.length === 0) validationErrors.push("Add at least one exercise.");
  for (const ex of exercises) {
    if (ex.setConfigs.length === 0) {
      validationErrors.push(`"${ex.exerciseName || "An exercise"}" needs at least one set.`);
      break;
    }
  }

  const canSave = validationErrors.length === 0 && !saveWorkout.isPending;

  async function handleSave() {
    setSubmitted(true);
    if (!profile) return;

    const parsed = workoutCreateSchema.safeParse({
      name: name.trim(),
      description: description.trim() || undefined,
      type,
      estimatedDurationMinutes: estimatedDurationMinutes ?? undefined,
      equipment: equipment.length > 0 ? equipment : undefined,
      warmupId: isWarmup ? undefined : warmupId || undefined,
    });
    if (!parsed.success || exercises.length === 0) return;

    const savedId = await saveWorkout.mutateAsync({
      workoutId,
      type,
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      estimatedDurationMinutes: parsed.data.estimatedDurationMinutes,
      equipment: parsed.data.equipment ?? [],
      warmupId: isWarmup ? null : parsed.data.warmupId ?? null,
      exercises,
      createdBy: profile.id,
    });

    navigate(`${basePath}/${savedId}`, { replace: true });
  }

  if (isEditing && (detailLoading || !hydrated)) {
    return <p className="text-sm text-[var(--ink-30)]">Loading…</p>;
  }

  return (
    <div className="pb-28">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate(basePath)}
          className="text-xs font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
        >
          &larr; Back to {noun}s
        </button>
        <h1 className="mt-2 font-display text-2xl text-[var(--ink)]">
          {isEditing ? `Edit ${noun}` : `New ${noun}`}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="admin-card space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`e.g. Upper body strength`}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)] ${
                  submitted && !name.trim() ? "border-[var(--bad)]" : "border-[var(--ink-08)]"
                }`}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional"
                className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">
                  Duration (minutes, e.g. "45" or "1:30")
                </label>
                <input
                  value={durationStr}
                  onChange={(e) => setDurationStr(e.target.value)}
                  placeholder="45"
                  className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
                />
              </div>

              {!isWarmup && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Warmup</label>
                  <select
                    value={warmupId}
                    onChange={(e) => setWarmupId(e.target.value)}
                    className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
                  >
                    <option value="">None</option>
                    {warmupOptions
                      .filter((w) => w.id !== workoutId)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">
                Equipment (comma-separated)
              </label>
              <input
                value={equipmentStr}
                onChange={(e) => setEquipmentStr(e.target.value)}
                placeholder="dumbbells, bench, mat"
                className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
              />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-[var(--ink-70)]">Exercises</h2>
            {exercises.length === 0 ? (
              <div className="admin-card p-6 text-center text-sm text-[var(--ink-30)]">
                No exercises yet — add some from the library on the right.
              </div>
            ) : (
              <SortableList
                items={exercises}
                getId={(ex) => ex.id}
                onReorder={setExercises}
                className="space-y-3"
                renderItem={(ex, index, dragHandleProps) => (
                  <ExerciseRow
                    item={ex}
                    index={index}
                    dragHandleProps={dragHandleProps}
                    onChange={(next) => setExercises((prev) => prev.map((e) => (e.id === next.id ? next : e)))}
                    onDuplicate={() =>
                      setExercises((prev) => {
                        const i = prev.findIndex((e) => e.id === ex.id);
                        if (i === -1) return prev;
                        const copy: BuilderExercise = { ...ex, id: newClientId() };
                        return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
                      })
                    }
                    onRemove={() => setExercises((prev) => prev.filter((e) => e.id !== ex.id))}
                  />
                )}
              />
            )}
          </div>
        </div>

        <div>
          {profile && <ExerciseLibraryPanel coachId={profile.id} onAdd={addExercise} />}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ink-08)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3 lg:pl-[calc(16rem+1.5rem)]">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-50)]">
            <span>{exercises.length} exercises</span>
            <span>·</span>
            <span>{totalSets} sets</span>
            <span>·</span>
            <span>
              ~{estimatedDurationMinutes ?? Math.round(estimatedFromSets)} min
              {estimatedDurationMinutes == null && durationStr.trim() === "" ? " (estimated)" : ""}
            </span>
          </div>
          {submitted && validationErrors.length > 0 && (
            <span className="text-xs font-medium text-[var(--bad)]">{validationErrors[0]}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(basePath)}
              className="rounded-lg border border-[var(--ink-08)] px-4 py-2 text-sm font-medium text-[var(--ink-70)] hover:bg-[var(--paper)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="rounded-lg bg-[var(--blue-deep)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {saveWorkout.isPending ? "Saving…" : `Save ${noun}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
