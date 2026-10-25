import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Exercise, SessionSection } from "@momentum/shared";
import { SortableList } from "../components/builder/SortableList";
import { ExerciseRow } from "../components/builder/ExerciseRow";
import { exerciseToBuilderRow } from "../components/builder/exerciseToBuilderRow";
import { ExerciseLibraryPanel } from "../components/exercises/ExerciseLibraryPanel";
import { MobileSheet } from "../components/MobileSheet";
import { ApplyToFutureDialog } from "../components/sessions/ApplyToFutureDialog";
import { SaveAsWorkoutDialog } from "../components/sessions/SaveAsWorkoutDialog";
import type { BuilderExercise } from "../queries/useWorkoutDetail";
import { useClientUnits } from "../queries/useClientUnits";
import {
  describeSaveSessionError,
  useSaveSession,
  useSessionDetail,
} from "../queries/useSessionDetail";
import { useUnsavedChangesGuard } from "../lib/useUnsavedChangesGuard";
import { useAuth } from "../lib/auth";
import { draftKey, useDraft } from "../lib/useDraft";
import { RestoreBanner } from "../components/builder/RestoreBanner";

/**
 * What is persisted locally between visits. A day's value is almost entirely
 * in its exercises, so the two text fields ride along rather than being the
 * point.
 */
interface SessionDraft {
  name: string;
  description: string;
  exercises: BuilderExercise[];
  warmupExercises: BuilderExercise[];
}

/**
 * Enough of a check that a corrupt or outdated draft is dropped rather than
 * spread into state — both arrays are rendered with `.map` and reach the save
 * RPC unvalidated.
 */
function isSessionDraft(value: unknown): boolean {
  const d = value as Partial<SessionDraft>;
  return (
    typeof d.name === "string" &&
    Array.isArray(d.exercises) &&
    Array.isArray(d.warmupExercises)
  );
}

/**
 * Editor for ONE scheduled day.
 *
 * A session owns its exercises, so everything here touches that day and
 * nothing else — not the client's other weeks, not another client, and never
 * the library workout it was built from. The two ways to reach beyond this
 * day are deliberate, separate actions in the footer (R9).
 *
 * Reuses the workout builder's parts wholesale — `SortableList`,
 * `ExerciseRow`, `ExerciseLibraryPanel` — because a day and a workout are the
 * same shape to edit; only where they are stored differs.
 */
export function SessionBuilderPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: detail, isLoading } = useSessionDetail(sessionId);
  const saveSession = useSaveSession();
  // New exercises start in the units this client prefers.
  const { data: clientUnits } = useClientUnits(detail?.clientId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [exercises, setExercises] = useState<BuilderExercise[]>([]);
  const [warmupExercises, setWarmupExercises] = useState<BuilderExercise[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dismissedRestore, setDismissedRestore] = useState(false);

  // The key is withheld until `detail` arrives. `useDraft` reads storage once,
  // when the key first becomes non-null, and reading it before the server copy
  // is known means `serverUpdatedAt` is null and every draft is waved through
  // — including one another device has already superseded, which Save would
  // then write back over the newer row.
  const draft = useDraft<SessionDraft>(
    detail ? draftKey(profile?.id, "session", sessionId) : null,
    detail?.updatedAt ?? null,
    isSessionDraft
  );

  useEffect(() => {
    if (!detail || hydrated) return;
    setName(detail.name);
    setDescription(detail.description ?? "");
    const toBuilder = (section: SessionSection) =>
      detail.exercises
        .filter((e) => e.section === section)
        .map((e) => ({
          id: e.id,
          exerciseId: e.exerciseId,
          exerciseName: "",
          mode: e.mode,
          setConfigs: e.setConfigs,
          restSeconds: e.restSeconds,
          notes: e.notes,
        }));
    setExercises(toBuilder("main"));
    setWarmupExercises(toBuilder("warmup"));
    setHydrated(true);
  }, [detail, hydrated]);

  // Applied *after* the server hydration above, or it would be overwritten the
  // moment the detail query resolves.
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (!hydrated || appliedDraft.current || !draft.restored) return;
    appliedDraft.current = true;
    const d = draft.restored;
    setName(d.name);
    setDescription(d.description);
    setExercises(d.exercises);
    setWarmupExercises(d.warmupExercises);
    setDirty(true);
  }, [hydrated, draft.restored]);

  // Persist on change, but only once hydrated — otherwise the empty initial
  // state is written over a real draft before it has been applied. Depends on
  // `draft.save` rather than `draft`, which is a new object every render.
  const saveDraft = draft.save;
  useEffect(() => {
    if (!hydrated || !dirty) return;
    saveDraft({ name, description, exercises, warmupExercises });
  }, [hydrated, dirty, name, description, exercises, warmupExercises, saveDraft]);

  const confirmLeave = useUnsavedChangesGuard(
    dirty,
    "This day has unsaved changes. They're saved on this device and will be restored when you come back. Leave anyway?"
  );

  function discardDraft() {
    draft.clear();
    setDismissedRestore(true);
    setDirty(false);
    // Re-run server hydration so the form returns to the saved day.
    appliedDraft.current = true;
    setHydrated(false);
  }

  function edit<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  function addExercise(exercise: Exercise) {
    setExercises((prev) => [
      ...prev,
      exerciseToBuilderRow(exercise, `new-${crypto.randomUUID()}`, clientUnits),
    ]);
    setDirty(true);
  }

  const totalSets = useMemo(
    () => exercises.reduce((sum, ex) => sum + ex.setConfigs.length, 0),
    [exercises]
  );

  async function handleSave() {
    if (!detail) return;
    setSaveError(null);
    try {
      await saveSession.mutateAsync({
        sessionId: detail.id,
        name,
        description,
        estimatedDurationMinutes: detail.estimatedDurationMinutes ?? undefined,
        warmupName: detail.warmupName,
        exercises: [
          ...warmupExercises.map((ex) => ({ ...ex, section: "warmup" as SessionSection })),
          ...exercises.map((ex) => ({ ...ex, section: "main" as SessionSection })),
        ].map((ex) => ({
          section: ex.section,
          exerciseId: ex.exerciseId,
          mode: ex.mode,
          setConfigs: ex.setConfigs,
          restSeconds: ex.restSeconds,
          notes: ex.notes,
        })),
        expectedUpdatedAt: detail.updatedAt,
      });
      setDirty(false);
      setSavedAt(new Date().toISOString());
      draft.clear();
      setDismissedRestore(true);
    } catch (error) {
      setSaveError(describeSaveSessionError(error));
    }
  }

  if (isLoading) return <p className="text-sm text-[var(--ink-30)]">Loading…</p>;
  if (!detail) return <p className="text-sm text-[var(--ink-30)]">This day no longer exists.</p>;

  return (
    <div className="pb-36 lg:pb-28">
      <button
        type="button"
        onClick={() => {
          if (confirmLeave()) navigate(-1);
        }}
        className="mb-6 text-xs font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
      >
        &larr; Back
      </button>

      {draft.restored && !dismissedRestore && (
        <RestoreBanner onDiscard={discardDraft} onDismiss={() => setDismissedRestore(true)} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="admin-card space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Name</label>
              <input
                value={name}
                onChange={(e) => edit(setName)(e.target.value)}
                placeholder="e.g. Upper body strength"
                className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">
                Description
              </label>
              <input
                value={description}
                onChange={(e) => edit(setDescription)(e.target.value)}
                className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
              />
            </div>
            {/* Stated plainly, because the whole point of sessions is that this
                is true and a coach has no way to tell by looking. */}
            <p className="text-xs text-[var(--ink-50)]">
              Changes here affect this day only.
            </p>
          </div>

          {warmupExercises.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-50)]">
                Warm-up
              </h2>
              <SortableList
                items={warmupExercises}
                getId={(ex) => ex.id}
                onReorder={(next) => {
                  setWarmupExercises(next);
                  setDirty(true);
                }}
                renderItem={(item, index, dragHandleProps) => (
                  <ExerciseRow
                    item={item}
                    index={index}
                    dragHandleProps={dragHandleProps}
                    onChange={(next) => {
                      setWarmupExercises((prev) =>
                        prev.map((ex) => (ex.id === item.id ? next : ex))
                      );
                      setDirty(true);
                    }}
                    onDuplicate={() => {
                      setWarmupExercises((prev) => [
                        ...prev,
                        { ...item, id: `new-${crypto.randomUUID()}` },
                      ]);
                      setDirty(true);
                    }}
                    onRemove={() => {
                      setWarmupExercises((prev) => prev.filter((ex) => ex.id !== item.id));
                      setDirty(true);
                    }}
                  />
                )}
              />
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-50)]">
                Exercises
              </h2>
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="admin-secondary px-3 py-1.5 text-xs lg:hidden"
              >
                + Add exercise
              </button>
            </div>
            {exercises.length === 0 ? (
              <p className="rounded-lg bg-[var(--paper)] px-3 py-6 text-center text-xs text-[var(--ink-30)]">
                No exercises on this day yet.
              </p>
            ) : (
              <SortableList
                items={exercises}
                getId={(ex) => ex.id}
                onReorder={(next) => {
                  setExercises(next);
                  setDirty(true);
                }}
                renderItem={(item, index, dragHandleProps) => (
                  <ExerciseRow
                    item={item}
                    index={index}
                    dragHandleProps={dragHandleProps}
                    onChange={(next) => {
                      setExercises((prev) => prev.map((ex) => (ex.id === item.id ? next : ex)));
                      setDirty(true);
                    }}
                    onDuplicate={() => {
                      setExercises((prev) => [
                        ...prev,
                        { ...item, id: `new-${crypto.randomUUID()}` },
                      ]);
                      setDirty(true);
                    }}
                    onRemove={() => {
                      setExercises((prev) => prev.filter((ex) => ex.id !== item.id));
                      setDirty(true);
                    }}
                  />
                )}
              />
            )}
          </div>
        </div>

        <div className="hidden lg:block">
          <ExerciseLibraryPanel coachId={profile?.id ?? ""} onAdd={addExercise} />
        </div>
      </div>

      <MobileSheet
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        side="bottom"
        label="Exercise library"
      >
        <ExerciseLibraryPanel
          coachId={profile?.id ?? ""}
          onAdd={(ex) => {
            addExercise(ex);
            setLibraryOpen(false);
          }}
        />
      </MobileSheet>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ink-08)] bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-50)]">
            <span>{exercises.length} exercises</span>
            <span>·</span>
            <span>{totalSets} sets</span>
            {savedAt && !dirty && <span className="text-[var(--good)]">Saved</span>}
          </div>
          {saveError && <span className="text-xs font-medium text-[var(--bad)]">{saveError}</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSaveAsOpen(true)}
              className="admin-secondary px-3 py-2 text-xs"
            >
              Save as workout
            </button>
            <button
              type="button"
              onClick={() => setApplyOpen(true)}
              disabled={dirty || !detail.sourceWorkoutId}
              title={
                dirty
                  ? "Save this day first"
                  : !detail.sourceWorkoutId
                    ? "This day was built from scratch, so there's nothing to match it to in later weeks"
                    : undefined
              }
              className="admin-secondary px-3 py-2 text-xs disabled:opacity-50"
            >
              Apply to later weeks
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saveSession.isPending}
              className="admin-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {saveSession.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {applyOpen && (
        <ApplyToFutureDialog sessionId={detail.id} onClose={() => setApplyOpen(false)} />
      )}
      {saveAsOpen && (
        <SaveAsWorkoutDialog
          sessionId={detail.id}
          defaultName={name}
          clientId={detail.clientId}
          onClose={() => setSaveAsOpen(false)}
        />
      )}
    </div>
  );
}
