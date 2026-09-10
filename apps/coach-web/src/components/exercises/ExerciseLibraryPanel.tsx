import { useMemo, useState } from "react";
import type { Exercise, ExerciseMode } from "@momentum/shared";
import { useDeleteExercise, useExercises, useUpdateExercise } from "../../queries/useExercises";
import { ExerciseCreateModal } from "./ExerciseCreateModal";
import { formatDuration, formatMiles } from "../../lib/workoutFormat";

const MODE_LABELS: Record<ExerciseMode, string> = { reps: "Reps", time: "Time", distance: "Distance" };
const MODES: ExerciseMode[] = ["reps", "time", "distance"];

function exerciseDefaultsSummary(ex: Exercise): string {
  const mode = ex.default_mode ?? "reps";
  if (mode === "time") return `${ex.default_sets || 3} x ${formatDuration(ex.default_duration_seconds ?? 45)}`;
  if (mode === "distance") return formatMiles(ex.default_miles ?? 1);
  return `${ex.default_sets || 3} x ${ex.default_reps || 10}`;
}

interface EditState {
  name: string;
  category: string;
  defaultSets: number;
  defaultReps: number;
  defaultMode: ExerciseMode;
  defaultDurationStr: string;
  defaultMiles: number;
  videoUrl: string;
}

export interface ExerciseLibraryPanelProps {
  coachId: string;
  /** Called when the coach clicks "Add" on a library entry — appends it to the workout with defaults. */
  onAdd: (exercise: Exercise) => void;
}

/**
 * Right-hand panel of the workout builder: search/filter the coach's
 * exercise library, add an entry to the workout being built, create a new
 * exercise inline, or expand an entry to edit its defaults in place.
 */
export function ExerciseLibraryPanel({ coachId, onAdd }: ExerciseLibraryPanelProps) {
  const { data: exercises = [], isLoading } = useExercises();
  const updateExercise = useUpdateExercise();
  const deleteExercise = useDeleteExercise();

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const ex of exercises) if (ex.category) set.add(ex.category);
    return Array.from(set).sort();
  }, [exercises]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return exercises.filter((ex) => {
      if (selectedCategory !== "all" && ex.category !== selectedCategory) return false;
      if (term && !ex.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [exercises, search, selectedCategory]);

  function openEdit(ex: Exercise) {
    if (expandedId === ex.id) {
      setExpandedId(null);
      setEditState(null);
      return;
    }
    setExpandedId(ex.id);
    setEditState({
      name: ex.name,
      category: ex.category ?? "",
      defaultSets: ex.default_sets ?? 3,
      defaultReps: ex.default_reps ?? 10,
      defaultMode: ex.default_mode ?? "reps",
      defaultDurationStr: formatDuration(ex.default_duration_seconds ?? 45) || "0:45",
      defaultMiles: ex.default_miles ?? 1,
      videoUrl: ex.video_url ?? "",
    });
  }

  async function handleSave(id: string) {
    if (!editState) return;
    await updateExercise.mutateAsync({
      id,
      patch: {
        name: editState.name.trim(),
        category: editState.category.trim() || null,
        default_sets: editState.defaultMode === "distance" ? 1 : Math.max(1, editState.defaultSets || 1),
        default_reps: editState.defaultMode === "reps" ? Math.max(1, editState.defaultReps || 1) : null,
        default_mode: editState.defaultMode,
        default_miles: editState.defaultMode === "distance" ? Math.max(0.1, editState.defaultMiles || 1) : null,
        video_url: editState.videoUrl.trim() || null,
      },
    });
    setExpandedId(null);
    setEditState(null);
  }

  async function handleDelete(id: string, name: string) {
    const ok = window.confirm(
      `Delete "${name}"? It will be removed from your exercise library. Existing workouts that use it keep working.`,
    );
    if (!ok) return;
    await deleteExercise.mutateAsync(id);
    if (expandedId === id) {
      setExpandedId(null);
      setEditState(null);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setCreateModalOpen(true)}
        className="mb-3 w-full admin-primary px-4 py-2.5 text-sm"
      >
        + New exercise
      </button>

      <div className="admin-card overflow-hidden">
        <div className="space-y-2 border-b border-[var(--ink-08)] bg-[var(--paper)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-30)]">
            Exercise library
          </p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exercises…"
            className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
          />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-xs outline-none focus:border-[var(--blue-deep)]"
          >
            <option value="all">All categories ({exercises.length})</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c} ({exercises.filter((ex) => ex.category === c).length})
              </option>
            ))}
          </select>
        </div>

        {isLoading && <p className="px-4 py-4 text-sm text-[var(--ink-30)]">Loading…</p>}
        {!isLoading && exercises.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-[var(--ink-30)]">
            No exercises yet.
            <br />
            Create one using the button above.
          </p>
        )}
        {!isLoading && exercises.length > 0 && filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-[var(--ink-30)]">No exercises match.</p>
        )}

        {/* The height cap is for the desktop rail. Below `lg` this panel lives
            in a bottom sheet that scrolls as a whole, and a second scroller
            nested inside it just traps the coach's flick. */}
        <div className="divide-y divide-[var(--ink-08)] lg:max-h-[70vh] lg:overflow-y-auto">
          {filtered.map((ex) => {
            const isOpen = expandedId === ex.id;
            return (
              <div key={ex.id}>
                <div className="flex items-center gap-2 px-4 py-3 hover:bg-[var(--paper)]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">{ex.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-30)]">
                      {ex.category ?? "uncategorized"} · {exerciseDefaultsSummary(ex)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAdd(ex)}
                    className="admin-primary px-3 py-1.5 text-xs"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(ex)}
                    aria-label={`Edit ${ex.name}`}
                    aria-expanded={isOpen}
                    className="flex h-10 w-10 flex-none items-center justify-center rounded-lg text-[var(--ink-30)] hover:bg-white hover:text-[var(--ink)] lg:h-auto lg:w-auto lg:p-1.5"
                  >
                    {isOpen ? "▴" : "▾"}
                  </button>
                </div>

                {isOpen && editState && (
                  <div className="space-y-3 border-t border-[var(--ink-08)] bg-[var(--paper)] px-4 pb-4 pt-3">
                    <div>
                      <label className="mb-1 block text-xs text-[var(--ink-50)]">Name</label>
                      <input
                        value={editState.name}
                        onChange={(e) => setEditState((s) => s && { ...s, name: e.target.value })}
                        className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--ink-50)]">Category</label>
                      <input
                        value={editState.category}
                        onChange={(e) => setEditState((s) => s && { ...s, category: e.target.value })}
                        className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--ink-50)]">Measure by</label>
                      <div className="flex overflow-hidden rounded-lg border border-[var(--ink-08)] bg-white">
                        {MODES.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setEditState((s) => s && { ...s, defaultMode: m })}
                            aria-pressed={editState.defaultMode === m}
                            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
                              editState.defaultMode === m
                                ? "bg-[var(--ink)] text-white"
                                : "bg-white text-[var(--ink-50)] hover:bg-[var(--paper)]"
                            }`}
                          >
                            {MODE_LABELS[m]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {editState.defaultMode === "reps" && (
                        <>
                          <div>
                            <label className="mb-1 block text-xs text-[var(--ink-50)]">Default sets</label>
                            <input
                              type="number"
                              min={1}
                              value={editState.defaultSets}
                              onChange={(e) =>
                                setEditState((s) => s && { ...s, defaultSets: Number(e.target.value) })
                              }
                              className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-[var(--ink-50)]">Default reps</label>
                            <input
                              type="number"
                              min={1}
                              value={editState.defaultReps}
                              onChange={(e) =>
                                setEditState((s) => s && { ...s, defaultReps: Number(e.target.value) })
                              }
                              className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                            />
                          </div>
                        </>
                      )}
                      {editState.defaultMode === "time" && (
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs text-[var(--ink-50)]">Default time</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={editState.defaultDurationStr}
                            onChange={(e) =>
                              setEditState((s) => s && { ...s, defaultDurationStr: e.target.value })
                            }
                            placeholder="0:45"
                            className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                          />
                        </div>
                      )}
                      {editState.defaultMode === "distance" && (
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs text-[var(--ink-50)]">Default miles</label>
                          <input
                            type="number"
                            min={0.1}
                            step="0.1"
                            value={editState.defaultMiles}
                            onChange={(e) =>
                              setEditState((s) => s && { ...s, defaultMiles: Number(e.target.value) })
                            }
                            className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--ink-50)]">Video URL</label>
                      <input
                        type="url"
                        value={editState.videoUrl}
                        onChange={(e) => setEditState((s) => s && { ...s, videoUrl: e.target.value })}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleSave(ex.id)}
                        disabled={updateExercise.isPending || !editState.name.trim()}
                        className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                      >
                        Save
                      </button>
                      <span className="flex-1 text-xs text-[var(--ink-30)]">
                        Defaults apply next time this exercise is added.
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleDelete(ex.id, ex.name)}
                        aria-label="Delete exercise"
                        className="rounded-lg p-1.5 text-[var(--ink-30)] hover:bg-red-50 hover:text-[var(--bad)]"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ExerciseCreateModal
        coachId={coachId}
        open={createModalOpen}
        categoryOptions={categoryOptions}
        onClose={() => setCreateModalOpen(false)}
        onCreated={onAdd}
      />
    </div>
  );
}
