import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Exercise, SetConfig, WorkoutType } from "@momentum/shared";
import { workoutCreateSchema } from "@momentum/shared";
import { useAuth } from "../lib/auth";
import { draftKey, useDraft } from "../lib/useDraft";
import { useUnsavedChangesGuard } from "../lib/useUnsavedChangesGuard";
import { SortableList } from "../components/builder/SortableList";
import { RestoreBanner } from "../components/builder/RestoreBanner";
import { ExerciseRow } from "../components/builder/ExerciseRow";
import { defaultSetConfig } from "../components/builder/defaultSetConfig";
import { ExerciseLibraryPanel } from "../components/exercises/ExerciseLibraryPanel";
import { MobileSheet } from "../components/MobileSheet";
import { useExercises } from "../queries/useExercises";
import { useWorkouts } from "../queries/useWorkouts";
import {
  describeSaveWorkoutError,
  useSaveWorkout,
  useWorkoutDetail,
  type BuilderExercise,
} from "../queries/useWorkoutDetail";
import { parseDurationMinutes, formatDurationMinutes, parseEquipmentTags } from "../lib/workoutFormat";

export interface WorkoutBuilderPageProps {
  /** "warmup" builds/edits a warmup instead of a workout (hides the warmup-selector field). */
  type?: WorkoutType;
}

/**
 * What is persisted locally between visits. Deliberately the raw form state,
 * strings included — a draft has to survive values that are mid-typing and
 * would not survive parsing ("1:" on the way to "1:30").
 */
interface WorkoutDraft {
  name: string;
  description: string;
  durationStr: string;
  equipmentStr: string;
  warmupId: string;
  exercises: BuilderExercise[];
}

/**
 * Enough of a check that a corrupt or outdated draft is dropped rather than
 * spread into state — `exercises` in particular is rendered with `.map` and
 * reaches the save RPC unvalidated.
 */
function isWorkoutDraft(value: unknown): boolean {
  const d = value as Partial<WorkoutDraft>;
  return typeof d.name === "string" && Array.isArray(d.exercises);
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
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Mobile-only: the exercise library as a bottom sheet. Ignored at `lg` and up. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [hydrated, setHydrated] = useState(!isEditing);
  const [dismissedRestore, setDismissedRestore] = useState(false);
  /** Set by any edit after hydration; what the nav guard and the draft writer key off. */
  const [dirty, setDirty] = useState(false);

  // `type` is in the key because the warmup builder is this same component on
  // a different route — without it a warmup draft restores into a workout.
  // In edit mode the key is withheld until `detail` arrives. `useDraft` reads
  // storage once, when the key first becomes non-null, and reading it before
  // the server copy is known means `serverUpdatedAt` is null and
  // `shouldRestoreDraft` waves every draft through — including one another
  // device has already superseded, which Save would then write back over the
  // newer row. In new-entity mode there is no server copy, so null is the right
  // answer immediately.
  const draft = useDraft<WorkoutDraft>(
    !isEditing || detail ? draftKey(profile?.id, type, workoutId) : null,
    detail?.updatedAt ?? null,
    isWorkoutDraft
  );

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

  // Apply a restored draft *after* the server hydration above, or it would be
  // overwritten the moment the detail query resolves. In new-workout mode
  // `hydrated` is true from the start, so this runs immediately.
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (!hydrated || appliedDraft.current || !draft.restored) return;
    appliedDraft.current = true;
    const d = draft.restored;
    setName(d.name);
    setDescription(d.description);
    setDurationStr(d.durationStr);
    setEquipmentStr(d.equipmentStr);
    setWarmupId(d.warmupId);
    setExercises(d.exercises);
    setDirty(true);
  }, [hydrated, draft.restored]);

  // Persist on change, but only once hydrated — otherwise the empty initial
  // state is written over a real draft before it has been applied.
  // Depends on `draft.save` rather than `draft`: the object is new every
  // render, and re-running this each time would restart the write debounce
  // indefinitely under any unrelated re-render. `save` is stable per key.
  const saveDraft = draft.save;
  useEffect(() => {
    if (!hydrated || !dirty) return;
    saveDraft({ name, description, durationStr, equipmentStr, warmupId, exercises });
  }, [hydrated, dirty, name, description, durationStr, equipmentStr, warmupId, exercises, saveDraft]);

  const confirmLeave = useUnsavedChangesGuard(
    dirty,
    "This workout has unsaved changes. They're saved on this device and will be restored when you come back. Leave anyway?"
  );

  /** Wraps a setter so every edit marks the form dirty in one place. */
  function edit<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      setDirty(true);
      setter(value);
    };
  }

  function discardDraft() {
    draft.clear();
    setDirty(false);
    setDismissedRestore(true);
    // Re-run server hydration; in new-workout mode there is nothing to reload,
    // so clear back to an empty form.
    if (isEditing) setHydrated(false);
    else {
      setName("");
      setDescription("");
      setDurationStr("");
      setEquipmentStr("");
      setWarmupId("");
      setExercises([]);
    }
  }

  function addExercise(ex: Exercise) {
    setDirty(true);
    setExercises((prev) => [...prev, exerciseToBuilderRow(ex)]);
    // No-op on desktop, where the library is a permanent rail.
    setLibraryOpen(false);
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

    let savedId: string;
    try {
      savedId = await saveWorkout.mutateAsync({
        workoutId,
        type,
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        estimatedDurationMinutes: parsed.data.estimatedDurationMinutes,
        equipment: parsed.data.equipment ?? [],
        warmupId: isWarmup ? null : parsed.data.warmupId ?? null,
        exercises,
        createdBy: profile.id,
        // What this editor loaded. If someone else saved in the meantime the
        // RPC raises stale_write rather than silently discarding their edit.
        expectedUpdatedAt: detail?.updatedAt ?? null,
      });
    } catch (error) {
      // Deliberately does not clear the draft: a failed save is exactly when
      // the local copy is the only one that exists.
      setSaveError(describeSaveWorkoutError(error));
      return;
    }

    setSaveError(null);
    // The save landed, so the draft has served its purpose. In new-workout mode
    // this must happen before the navigate below, which changes the key from
    // ":new" to the saved id and would otherwise strand the draft to be offered
    // again on the next new workout.
    draft.clear();
    setDirty(false);
    navigate(`${basePath}/${savedId}`, { replace: true });
  }

  if (isEditing && (detailLoading || !hydrated)) {
    return <p className="text-sm text-[var(--ink-30)]">Loading…</p>;
  }

  return (
    <div className="pb-36 lg:pb-28">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => {
                if (confirmLeave()) navigate(basePath);
              }}
          className="text-xs font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
        >
          &larr; Back to {noun}s
        </button>
        <h1 className="mt-2 font-display text-2xl text-[var(--ink)]">
          {isEditing ? `Edit ${noun}` : `New ${noun}`}
        </h1>
      </div>

      {draft.didRestore && !dismissedRestore && (
        <RestoreBanner onDiscard={discardDraft} onDismiss={() => setDismissedRestore(true)} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="admin-card space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Name</label>
              <input
                value={name}
                onChange={(e) => edit(setName)(e.target.value)}
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
                onChange={(e) => edit(setDescription)(e.target.value)}
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
                  onChange={(e) => edit(setDurationStr)(e.target.value)}
                  placeholder="45"
                  className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
                />
              </div>

              {!isWarmup && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Warmup</label>
                  <select
                    value={warmupId}
                    onChange={(e) => edit(setWarmupId)(e.target.value)}
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
                onChange={(e) => edit(setEquipmentStr)(e.target.value)}
                placeholder="dumbbells, bench, mat"
                className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--ink-70)]">Exercises</h2>
              {/* Below `lg` the library rail is stacked underneath this list,
                  so adding a fifth exercise would mean scrolling past four of
                  them and back. Same panel, reached from here instead. */}
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="admin-secondary px-3 py-2 text-xs lg:hidden"
              >
                + Add exercise
              </button>
            </div>
            {exercises.length === 0 ? (
              <div className="admin-card p-6 text-center text-sm text-[var(--ink-30)]">
                No exercises yet — add some from the library.
              </div>
            ) : (
              <SortableList
                items={exercises}
                getId={(ex) => ex.id}
                onReorder={edit(setExercises)}
                className="space-y-3"
                renderItem={(ex, index, dragHandleProps) => (
                  <ExerciseRow
                    item={ex}
                    index={index}
                    dragHandleProps={dragHandleProps}
                    onChange={(next) => {
                      setDirty(true);
                      setExercises((prev) => prev.map((e) => (e.id === next.id ? next : e)));
                    }}
                    onDuplicate={() => {
                      setDirty(true);
                      setExercises((prev) => {
                        const i = prev.findIndex((e) => e.id === ex.id);
                        if (i === -1) return prev;
                        const copy: BuilderExercise = { ...ex, id: newClientId() };
                        return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
                      });
                    }}
                    onRemove={() => {
                      setDirty(true);
                      setExercises((prev) => prev.filter((e) => e.id !== ex.id));
                    }}
                  />
                )}
              />
            )}
          </div>
        </div>

        <div className="hidden lg:block">
          {profile && <ExerciseLibraryPanel coachId={profile.id} onAdd={addExercise} />}
        </div>
      </div>

      <MobileSheet
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        side="bottom"
        label="Exercise library"
      >
        <div className="overflow-y-auto p-4">
          {profile && <ExerciseLibraryPanel coachId={profile.id} onAdd={addExercise} />}
        </div>
      </MobileSheet>

      {/* Stops at the sidebar rather than spanning the viewport. `inset-x-0`
          laid this bar over the sidebar's bottom rows, which is where Sign out
          lives — visually covered, and intercepting the click. Ending the bar
          at the content column also retires the `pl-[calc(16rem+1.5rem)]` hack
          that was compensating for the overlap. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ink-08)] bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-3">
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
              onClick={() => {
                if (confirmLeave()) navigate(basePath);
              }}
              className="admin-secondary px-4 py-2 text-sm"
            >
              Cancel
            </button>
            {saveError && (
              <p className="mb-3 rounded-lg bg-[var(--bad-bg,#fdeceb)] px-3 py-2 text-sm text-[var(--bad)]">
                {saveError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="admin-primary px-4 py-2 text-sm disabled:opacity-40"
            >
              {saveWorkout.isPending ? "Saving…" : `Save ${noun}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
