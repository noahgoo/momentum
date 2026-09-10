import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { DayOfWeek, ProgramPreview, WeekSchedule } from "@momentum/shared";
import { programCreateSchema } from "@momentum/shared";
import { useAuth } from "../lib/auth";
import { useWorkouts } from "../queries/useWorkouts";
import {
  describeSaveProgramError,
  useProgramDetail,
  useSaveProgram,
  type BuilderPhase,
} from "../queries/usePrograms";
import { PhaseListPanel } from "../components/programs/PhaseListPanel";
import { PhaseEditor } from "../components/programs/PhaseEditor";
import { WeekScheduleEditor } from "../components/programs/WeekScheduleEditor";
import { SchedulePreview } from "../components/programs/SchedulePreview";

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newPhase(index: number): BuilderPhase {
  return {
    id: newClientId(),
    name: `Phase ${index}`,
    weeks: 4,
    activeDays: [],
    weekSchedule: {},
  };
}

/**
 * Program builder (new + edit). Name/description, phased-vs-flat toggle,
 * and either:
 * - Phased: LEFT sortable phase list + RIGHT PhaseEditor for the selected
 *   phase (phase-local week numbering).
 * - Flat: the same week-schedule editor inline at the program level, with
 *   an explicit weeks-count input (global week numbering).
 *
 * Plus a collapsed "Preview schedule" panel proving the builder's output
 * flattens the same way `resolve_scheduled_workout` (SQL) would resolve it.
 */
export function ProgramBuilderPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const programId = params.id;
  const isEditing = !!programId;

  const { data: detail, isLoading: detailLoading } = useProgramDetail(programId);
  const { data: workouts = [] } = useWorkouts("workout");
  const saveProgram = useSaveProgram();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phased, setPhased] = useState(false);
  const [phases, setPhases] = useState<BuilderPhase[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [flatWeeks, setFlatWeeks] = useState(4);
  const [flatActiveDays, setFlatActiveDays] = useState<DayOfWeek[]>([]);
  const [flatWeekSchedule, setFlatWeekSchedule] = useState<WeekSchedule>({});
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(!isEditing);

  useEffect(() => {
    if (!isEditing || !detail || hydrated) return;
    setName(detail.name);
    setDescription(detail.description ?? "");
    setPhased(detail.phased);
    setPhases(detail.phases);
    setSelectedPhaseId(detail.phases[0]?.id ?? null);
    setFlatWeeks(detail.weeks ?? 4);
    setFlatActiveDays(detail.flatActiveDays);
    setFlatWeekSchedule(detail.flatWeekSchedule);
    setHydrated(true);
  }, [isEditing, detail, hydrated]);

  const selectedPhase = phases.find((p) => p.id === selectedPhaseId) ?? null;

  function handleTogglePhased() {
    const next = !phased;
    const hasSchedule = phased
      ? phases.some((p) => Object.keys(p.weekSchedule).length > 0)
      : Object.keys(flatWeekSchedule).length > 0;

    if (hasSchedule) {
      const ok = window.confirm(
        next
          ? "Switching to phased mode will clear the current flat week schedule. Continue?"
          : "Switching to flat mode will clear all phases and their schedules. Continue?",
      );
      if (!ok) return;
    }

    if (next) {
      // Converting flat -> phased: clear flat state, start with one phase.
      setFlatWeekSchedule({});
      setFlatActiveDays([]);
      if (phases.length === 0) {
        const p = newPhase(1);
        setPhases([p]);
        setSelectedPhaseId(p.id);
      }
    } else {
      // Converting phased -> flat: clear phases.
      setPhases([]);
      setSelectedPhaseId(null);
    }
    setPhased(next);
  }

  function addPhase() {
    const p = newPhase(phases.length + 1);
    setPhases((prev) => [...prev, p]);
    setSelectedPhaseId(p.id);
  }

  function removePhase(id: string) {
    setPhases((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (selectedPhaseId === id) {
        setSelectedPhaseId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  function updatePhase(updated: BuilderPhase) {
    setPhases((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function toggleFlatDay(day: DayOfWeek) {
    const next = flatActiveDays.includes(day)
      ? flatActiveDays.filter((d) => d !== day)
      : [...flatActiveDays, day];
    const cleaned = Object.fromEntries(
      Object.entries(flatWeekSchedule).map(([week, daySchedule]) => [
        week,
        Object.fromEntries(Object.entries(daySchedule).filter(([d]) => next.includes(d as DayOfWeek))),
      ]),
    );
    setFlatActiveDays(next);
    setFlatWeekSchedule(cleaned);
  }

  function setFlatWorkout(week: number, day: DayOfWeek, workoutId: string) {
    setFlatWeekSchedule((prev) => ({
      ...prev,
      [String(week)]: { ...prev[String(week)], [day]: workoutId },
    }));
  }

  function setFlatWeeksCount(raw: string) {
    const count = raw === "" ? 0 : Math.max(1, Math.min(52, Number(raw) || 0));
    setFlatWeeks(count);
    setFlatWeekSchedule((prev) => Object.fromEntries(Object.entries(prev).filter(([week]) => Number(week) <= count)));
  }

  const totalWeeks = phased ? phases.reduce((sum, p) => sum + (p.weeks || 0), 0) : flatWeeks;

  // Preview: flatten the current builder state into the shared
  // ProgramPreview shape, then let resolveWeekSchedule do the global-week
  // flattening (phased) or pass through unchanged (flat).
  const previewProgram: ProgramPreview = useMemo(
    () =>
      phased
        ? {
            id: programId ?? "preview",
            weeks: totalWeeks,
            weekSchedule: {},
            phases: phases.map((p) => ({ id: p.id, weeks: p.weeks, weekSchedule: p.weekSchedule })),
          }
        : {
            id: programId ?? "preview",
            weeks: totalWeeks,
            weekSchedule: flatWeekSchedule,
          },
    [phased, phases, flatWeekSchedule, totalWeeks, programId],
  );

  const validationErrors: string[] = [];
  if (!name.trim()) validationErrors.push("Name is required.");
  if (phased && phases.length === 0) validationErrors.push("Add at least one phase.");
  if (phased) {
    for (const p of phases) {
      if (p.weeks < 1) {
        validationErrors.push(`"${p.name || "A phase"}" needs at least 1 week.`);
        break;
      }
    }
  }
  if (!phased && flatWeeks < 1) validationErrors.push("Weeks must be at least 1.");

  const canSave = validationErrors.length === 0 && !saveProgram.isPending;

  async function handleSave() {
    setSubmitted(true);
    if (!profile) return;

    const parsed = programCreateSchema.safeParse({
      name: name.trim(),
      description: description.trim() || undefined,
      weeks: totalWeeks,
      phases: phased
        ? phases.map((p) => ({
            name: p.name.trim() || undefined,
            weeks: p.weeks,
            activeDays: p.activeDays,
          }))
        : undefined,
    });
    if (!parsed.success) return;

    let savedId: string;
    try {
      savedId = await saveProgram.mutateAsync({
        programId,
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        createdBy: profile.id,
        phased,
        phases,
        flatWeeks,
        flatActiveDays,
        flatWeekSchedule,
        // What this editor loaded. If someone else saved in the meantime the
        // RPC raises stale_write rather than silently discarding their edit.
        expectedUpdatedAt: detail?.updatedAt ?? null,
      });
    } catch (error) {
      setSaveError(describeSaveProgramError(error));
      return;
    }

    setSaveError(null);
    navigate(`/library/programs/${savedId}`, { replace: true });
  }

  if (isEditing && (detailLoading || !hydrated)) {
    return <p className="text-sm text-[var(--ink-30)]">Loading…</p>;
  }

  return (
    <div className="pb-36 lg:pb-28">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate("/library/programs")}
          className="text-xs font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
        >
          &larr; Back to programs
        </button>
        <h1 className="mt-2 font-display text-2xl text-[var(--ink)]">
          {isEditing ? "Edit program" : "New program"}
        </h1>
      </div>

      <div className="space-y-6">
        <div className="admin-card space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Foundation"
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

          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--ink-08)] bg-[var(--paper)] px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-[var(--ink-70)]">Phased program</p>
              <p className="text-xs text-[var(--ink-30)]">
                {phased
                  ? "Multiple sequential phases, each with its own schedule."
                  : "A single flat week-by-week schedule."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={phased}
              onClick={handleTogglePhased}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                phased ? "bg-[var(--blue-deep)]" : "bg-[var(--ink-08)]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  phased ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        {phased ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-[var(--ink-70)]">Phases</h2>
              <PhaseListPanel
                phases={phases}
                selectedId={selectedPhaseId}
                onReorder={setPhases}
                onSelect={setSelectedPhaseId}
                onAdd={addPhase}
                onRemove={removePhase}
              />
            </div>
            <div className="admin-card p-5">
              {selectedPhase ? (
                <PhaseEditor phase={selectedPhase} workouts={workouts} onChange={updatePhase} />
              ) : (
                <p className="text-sm italic text-[var(--ink-30)]">Select or add a phase to edit its schedule.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="admin-card space-y-4 p-5">
            <div className="max-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Weeks</label>
              <input
                type="number"
                min={1}
                max={52}
                value={flatWeeks > 0 ? flatWeeks : ""}
                onChange={(e) => setFlatWeeksCount(e.target.value)}
                className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
              />
            </div>
            <WeekScheduleEditor
              weeks={flatWeeks}
              activeDays={flatActiveDays}
              weekSchedule={flatWeekSchedule}
              workouts={workouts}
              onToggleDay={toggleFlatDay}
              onSetWorkout={setFlatWorkout}
            />
          </div>
        )}

        <SchedulePreview program={previewProgram} workouts={workouts} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ink-08)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-3 lg:pl-[calc(16rem+1.5rem)]">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-50)]">
            <span>{totalWeeks} weeks</span>
            <span>·</span>
            <span>{phased ? `${phases.length} phase${phases.length === 1 ? "" : "s"}` : "Flat"}</span>
          </div>
          {submitted && validationErrors.length > 0 && (
            <span className="text-xs font-medium text-[var(--bad)]">{validationErrors[0]}</span>
          )}
          {saveError && <span className="text-xs font-medium text-[var(--bad)]">{saveError}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/library/programs")}
              className="admin-secondary px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="admin-primary px-4 py-2 text-sm disabled:opacity-40"
            >
              {saveProgram.isPending ? "Saving…" : "Save program"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
