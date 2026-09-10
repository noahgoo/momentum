import { useEffect, useId, useState, type FormEvent } from "react";
import type { Exercise, ExerciseMode } from "@momentum/shared";
import { useCreateExercise } from "../../queries/useExercises";
import { formatDuration, parseDuration } from "../../lib/workoutFormat";

const MODE_OPTIONS: Array<{ value: ExerciseMode; label: string }> = [
  { value: "reps", label: "Reps" },
  { value: "time", label: "Time" },
  { value: "distance", label: "Distance" },
];

interface Props {
  coachId: string;
  open: boolean;
  initialName?: string;
  categoryOptions?: string[];
  submitLabel?: string;
  onClose: () => void;
  onCreated: (exercise: Exercise) => void;
}

/** Inline modal to create a new exercise-library entry (name/category/mode/defaults). */
export function ExerciseCreateModal({
  coachId,
  open,
  initialName = "",
  categoryOptions = [],
  submitLabel = "Create exercise",
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState("strength");
  const [defaultSets, setDefaultSets] = useState(3);
  const [defaultReps, setDefaultReps] = useState(10);
  const [defaultMode, setDefaultMode] = useState<ExerciseMode>("reps");
  const [defaultDurationStr, setDefaultDurationStr] = useState("0:45");
  const [defaultMiles, setDefaultMiles] = useState(1);
  const [videoUrl, setVideoUrl] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const categoryListId = useId();
  const createExercise = useCreateExercise();

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setCategory("strength");
    setDefaultSets(3);
    setDefaultReps(10);
    setDefaultMode("reps");
    setDefaultDurationStr("0:45");
    setDefaultMiles(1);
    setVideoUrl("");
    setSubmitted(false);
  }, [initialName, open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const exercise = await createExercise.mutateAsync({
      name: trimmedName,
      category: category.trim() || null,
      default_sets: defaultMode === "distance" ? 1 : Math.max(1, defaultSets || 1),
      default_reps: defaultMode === "reps" ? Math.max(1, defaultReps || 1) : null,
      default_duration_seconds: defaultMode === "time" ? (parseDuration(defaultDurationStr) ?? 45) : null,
      default_miles: defaultMode === "distance" ? Math.max(0.1, defaultMiles || 1) : null,
      default_mode: defaultMode,
      video_url: videoUrl.trim() || null,
      created_by: coachId,
    });
    onCreated(exercise);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label="New exercise"
        className="admin-card max-h-full w-full max-w-lg overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--ink-08)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-30)]">
              Exercise library
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]">New exercise</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close new exercise modal"
            className="rounded-xl p-2 text-[var(--ink-50)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Exercise name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (submitted) setSubmitted(false);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)] ${
                submitted && !name.trim() ? "border-[var(--bad)]" : "border-[var(--ink-08)]"
              }`}
              placeholder="e.g. Goblet squat"
            />
            {submitted && !name.trim() && (
              <p className="mt-1 text-xs text-[var(--bad)]">Add an exercise name to create it.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
              list={categoryListId}
              placeholder="strength"
            />
            <datalist id={categoryListId}>
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Measure by</label>
            <div className="flex overflow-hidden rounded-lg border border-[var(--ink-08)] bg-white">
              {MODE_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setDefaultMode(m.value)}
                  aria-pressed={defaultMode === m.value}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    defaultMode === m.value
                      ? "bg-[var(--ink)] text-white"
                      : "bg-white text-[var(--ink-50)] hover:bg-[var(--paper)]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {defaultMode !== "distance" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Default sets</label>
                <input
                  type="number"
                  min={1}
                  value={defaultSets}
                  onChange={(e) => setDefaultSets(Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
                />
              </div>
            )}
            {defaultMode === "reps" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Default reps</label>
                <input
                  type="number"
                  min={1}
                  value={defaultReps}
                  onChange={(e) => setDefaultReps(Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
                />
              </div>
            )}
            {defaultMode === "time" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Default time</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={defaultDurationStr}
                  onChange={(e) => setDefaultDurationStr(e.target.value)}
                  onBlur={() => {
                    const parsed = parseDuration(defaultDurationStr);
                    setDefaultDurationStr(parsed != null ? formatDuration(parsed) : "0:45");
                  }}
                  placeholder="0:45"
                  className="w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
                />
              </div>
            )}
            {defaultMode === "distance" && (
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Default miles</label>
                <input
                  type="number"
                  min={0.1}
                  step="0.1"
                  value={defaultMiles}
                  onChange={(e) => setDefaultMiles(Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
                />
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Video URL (optional)</label>
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--ink-08)] bg-[var(--paper)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="admin-secondary px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createExercise.isPending || !name.trim()}
            className="admin-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            {createExercise.isPending ? "Creating…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
