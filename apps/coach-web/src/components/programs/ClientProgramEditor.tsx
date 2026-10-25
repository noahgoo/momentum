import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { DayOfWeek } from "@momentum/shared";
import { useAuth } from "../../lib/auth";
import { draftKey, useDraft } from "../../lib/useDraft";
import { useUnsavedChangesGuard } from "../../lib/useUnsavedChangesGuard";
import { RestoreBanner } from "../builder/RestoreBanner";
import { useWorkouts } from "../../queries/useWorkouts";
import {
  describeSaveClientProgramError,
  useClientProgram,
  useSaveClientProgram,
  type EditorDayContent,
} from "../../queries/useClientProgram";

const DAYS: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABEL: Record<DayOfWeek, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

interface EditorPhase {
  /** Stable within this editor; equals the row id for a saved phase. */
  key: string;
  id: string | null;
  name: string;
  weeks: number;
}

interface EditorDay {
  key: string;
  /** Null in a flat program. */
  phaseKey: string | null;
  week: number;
  day: DayOfWeek;
  content: EditorDayContent;
}

interface ClientProgramDraft {
  name: string;
  description: string;
  phased: boolean;
  phases: EditorPhase[];
  flatWeeks: number;
  days: EditorDay[];
}

function isClientProgramDraft(value: unknown): boolean {
  const d = value as Partial<ClientProgramDraft>;
  return (
    typeof d.name === "string" &&
    typeof d.phased === "boolean" &&
    Array.isArray(d.phases) &&
    Array.isArray(d.days) &&
    typeof d.flatWeeks === "number"
  );
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clampWeeks(raw: string): number {
  return raw === "" ? 0 : Math.max(1, Math.min(52, Number(raw) || 0));
}

/** Where a day sits: which scope, which week, which weekday. */
interface Slot {
  phaseKey: string | null;
  week: number;
  day: DayOfWeek;
}

const sameSlot = (a: Slot, b: Slot) => a.phaseKey === b.phaseKey && a.week === b.week && a.day === b.day;

/** Calendar date (yyyy-mm-dd) -> Date at local noon, immune to DST edges. */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * The date a slot lands on. Weeks count from the assignment's start date (not
 * from Monday), the same way resolve_scheduled_workout does, so week n covers
 * start + 7(n-1) .. +6 and the weekday picks the one date in that span.
 */
function slotDate(start: string, globalWeek: number, day: DayOfWeek): string {
  const base = parseDate(start);
  const startIdx = (base.getDay() + 6) % 7; // Mon = 0
  const dayOffset = (DAYS.indexOf(day) - startIdx + 7) % 7;
  base.setDate(base.getDate() + (globalWeek - 1) * 7 + dayOffset);
  return DATE_FORMAT.format(base);
}

/** Which inline form, if any, is open under a row. */
type OpenForm =
  | { kind: "pick"; slot: Slot; replacing: string | null }
  | { kind: "move"; dayKey: string };

/**
 * Editor for ONE CLIENT'S copy of a program. Assigning deep-copies a program
 * for the client (R1), so every part of this copy is the coach's to change
 * for that client without reaching the template or anyone else: name, weeks,
 * phases, and every day — add from the library, add blank, replace, move,
 * swap, remove.
 *
 * A day is held by identity (its session id), never by "the library workout
 * in this slot", so a day the coach has edited, built blank, or that was
 * migrated without a library source survives every save untouched unless the
 * coach replaces or removes it. Saves go through save_client_program in one
 * transaction. Workout logs are never touched by any of this.
 */
export function ClientProgramEditor({ programId }: { programId: string }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data: program, isLoading, isError, refetch } = useClientProgram(programId);
  const { data: workouts = [] } = useWorkouts("workout", program?.clientId);
  const save = useSaveClientProgram();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phased, setPhased] = useState(false);
  const [phases, setPhases] = useState<EditorPhase[]>([]);
  const [flatWeeks, setFlatWeeks] = useState(1);
  const [days, setDays] = useState<EditorDay[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [openForm, setOpenForm] = useState<OpenForm | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dismissedRestore, setDismissedRestore] = useState(false);

  // Key withheld until the server copy is known; see ProgramBuilderPage.
  const draft = useDraft<ClientProgramDraft>(
    program ? draftKey(profile?.id, "client-program", programId) : null,
    program?.updatedAt ?? null,
    isClientProgramDraft
  );

  useEffect(() => {
    if (!program || hydrated) return;
    setName(program.name);
    setDescription(program.description ?? "");
    setPhased(program.phased);
    setPhases(program.phases.map((p) => ({ key: p.id, id: p.id, name: p.name, weeks: p.weeks })));
    setFlatWeeks(program.weeks);
    setDays(
      program.days.map((d) => ({
        key: d.sessionId,
        phaseKey: d.phaseId,
        week: d.week,
        day: d.day,
        content: { kind: "session", sessionId: d.sessionId, name: d.name },
      }))
    );
    setHydrated(true);
  }, [program, hydrated]);

  const appliedDraft = useRef(false);
  useEffect(() => {
    if (!hydrated || appliedDraft.current || !draft.restored) return;
    appliedDraft.current = true;
    const d = draft.restored;
    setName(d.name);
    setDescription(d.description);
    setPhased(d.phased);
    setPhases(d.phases);
    setFlatWeeks(d.flatWeeks);
    setDays(d.days);
    setDirty(true);
  }, [hydrated, draft.restored]);

  const saveDraft = draft.save;
  useEffect(() => {
    if (!hydrated || !dirty) return;
    saveDraft({ name, description, phased, phases, flatWeeks, days });
  }, [hydrated, dirty, name, description, phased, phases, flatWeeks, days, saveDraft]);

  const confirmLeave = useUnsavedChangesGuard(
    dirty,
    "This program has unsaved changes. They're saved on this device and will be restored when you come back. Leave anyway?"
  );

  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setDirty(true);
      setSavedAt(null);
      setter(v);
    };
  }

  function discardDraft() {
    draft.clear();
    setDirty(false);
    setDismissedRestore(true);
    setOpenForm(null);
    setHydrated(false);
  }

  const totalWeeks = phased ? phases.reduce((sum, p) => sum + (p.weeks || 0), 0) : flatWeeks;
  const dayAt = (slot: Slot) => days.find((d) => sameSlot(d, slot)) ?? null;

  // ---- Structure -----------------------------------------------------------

  function togglePhased() {
    setOpenForm(null);
    if (!phased) {
      // Flat -> phased: everything becomes phase 1, nothing is lost.
      const key = newKey();
      edit(setPhases)([{ key, id: null, name: "Phase 1", weeks: Math.max(flatWeeks, 1) }]);
      setDays((prev) => prev.map((d) => ({ ...d, phaseKey: key })));
      setPhased(true);
      return;
    }
    // Phased -> flat: flatten phase-local weeks onto global weeks, the same
    // way resolve_scheduled_workout does (R5).
    const offsets = new Map<string, number>();
    let offset = 0;
    for (const p of phases) {
      offsets.set(p.key, offset);
      offset += p.weeks || 0;
    }
    edit(setFlatWeeks)(Math.max(offset, 1));
    setDays((prev) =>
      prev.map((d) => ({ ...d, phaseKey: null, week: (offsets.get(d.phaseKey ?? "") ?? 0) + d.week }))
    );
    setPhases([]);
    setPhased(false);
  }

  /** Drops days that no longer fit, after asking. Returns false if the coach declined. */
  function confirmDrop(dropped: EditorDay[], what: string): boolean {
    if (dropped.length === 0) return true;
    return window.confirm(
      `${what} removes ${dropped.length} scheduled day${dropped.length === 1 ? "" : "s"} from this client's program. Their past logs are kept. Continue?`
    );
  }

  function setScopeWeeks(phaseKey: string | null, raw: string) {
    const weeks = clampWeeks(raw);
    const dropped = weeks > 0 ? days.filter((d) => d.phaseKey === phaseKey && d.week > weeks) : [];
    if (!confirmDrop(dropped, "Shortening this")) return;
    if (phaseKey === null) edit(setFlatWeeks)(weeks);
    else edit(setPhases)(phases.map((p) => (p.key === phaseKey ? { ...p, weeks } : p)));
    if (dropped.length > 0) setDays((prev) => prev.filter((d) => !dropped.includes(d)));
  }

  function addPhase() {
    edit(setPhases)([...phases, { key: newKey(), id: null, name: `Phase ${phases.length + 1}`, weeks: 4 }]);
  }

  function removePhase(key: string) {
    const dropped = days.filter((d) => d.phaseKey === key);
    if (phases.length === 1) return;
    if (!confirmDrop(dropped, "Removing this phase")) return;
    edit(setPhases)(phases.filter((p) => p.key !== key));
    setDays((prev) => prev.filter((d) => d.phaseKey !== key));
    setOpenForm(null);
  }

  function movePhase(key: string, by: -1 | 1) {
    const i = phases.findIndex((p) => p.key === key);
    const j = i + by;
    if (j < 0 || j >= phases.length) return;
    const next = [...phases];
    [next[i], next[j]] = [next[j]!, next[i]!];
    edit(setPhases)(next);
  }

  // ---- Days ----------------------------------------------------------------

  function placeDay(slot: Slot, content: EditorDayContent, replacing: string | null) {
    edit(setDays)([
      ...days.filter((d) => d.key !== replacing && !sameSlot(d, slot)),
      { key: newKey(), ...slot, content },
    ]);
    setOpenForm(null);
  }

  function removeDay(key: string) {
    edit(setDays)(days.filter((d) => d.key !== key));
    setOpenForm(null);
  }

  /** Moves a day; if the target already has one, the two swap. */
  function moveDay(key: string, target: Slot) {
    const moving = days.find((d) => d.key === key);
    if (!moving) return;
    const occupant = dayAt(target);
    const from: Slot = { phaseKey: moving.phaseKey, week: moving.week, day: moving.day };
    edit(setDays)(
      days.map((d) => {
        if (d.key === key) return { ...d, ...target };
        if (occupant && d.key === occupant.key) return { ...d, ...from };
        return d;
      })
    );
    setOpenForm(null);
  }

  // ---- Save ----------------------------------------------------------------

  const validationError = !name.trim()
    ? "Name is required."
    : phased && phases.some((p) => p.weeks < 1)
      ? "Every phase needs at least 1 week."
      : !phased && flatWeeks < 1
        ? "Weeks must be at least 1."
        : null;

  async function handleSave() {
    if (!program || validationError) return;
    const phaseIndex = new Map(phases.map((p, i) => [p.key, i]));
    try {
      await save.mutateAsync({
        programId,
        name: name.trim(),
        description: description.trim(),
        phased,
        phases: phases.map((p) => ({ id: p.id, name: p.name.trim(), weeks: p.weeks })),
        flatWeeks,
        days: days.map((d) => ({
          phaseIndex: d.phaseKey === null ? null : (phaseIndex.get(d.phaseKey) ?? null),
          week: d.week,
          day: d.day,
          content: d.content,
        })),
        expectedUpdatedAt: program.updatedAt,
      });
    } catch (error) {
      // The draft stays: a failed save is when the local copy matters most.
      setSaveError(describeSaveClientProgramError(error));
      return;
    }
    setSaveError(null);
    draft.clear();
    setDirty(false);
    setOpenForm(null);
    // Re-read the server copy so new days get their session ids (and so an
    // Edit link for them appears). Awaited: re-hydrating from the cached copy
    // before the refetch lands would put the pre-save program back on screen.
    await refetch();
    setHydrated(false);
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }

  // ---- Render --------------------------------------------------------------

  const scopes = useMemo(() => {
    let offset = 0;
    return phased
      ? phases.map((p, i) => {
          const scope = { phaseKey: p.key as string | null, phase: p, index: i, weeks: p.weeks, weekOffset: offset };
          offset += p.weeks || 0;
          return scope;
        })
      : [{ phaseKey: null as string | null, phase: null, index: 0, weeks: flatWeeks, weekOffset: 0 }];
  }, [phased, phases, flatWeeks]);

  if (isLoading || (program && !hydrated)) {
    return <p className="text-sm text-[var(--ink-30)]">Loading…</p>;
  }
  if (isError || !program) {
    return (
      <div className="admin-card p-6">
        <p className="text-sm text-red-600">
          This program couldn&apos;t be loaded. It may have been deleted, or something went wrong — try reloading the
          page.
        </p>
      </div>
    );
  }

  const libraryWorkouts = workouts.filter((w) => !w.client_id);
  const shelfWorkouts = workouts.filter((w) => w.client_id);
  const inputClass =
    "w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]";

  return (
    <div className="pb-36 lg:pb-28">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => {
            if (confirmLeave()) navigate(-1);
          }}
          className="text-xs font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
        >
          &larr; Back
        </button>
        <h1 className="mt-2 font-display text-2xl text-[var(--ink)]">Edit client program</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--ink-50)]">
          This is this client&apos;s own copy. Changes here reach only them — never the template or anyone else on
          it. Past workout logs are always kept.
        </p>
      </div>

      {draft.didRestore && !dismissedRestore && (
        <RestoreBanner onDiscard={discardDraft} onDismiss={() => setDismissedRestore(true)} />
      )}

      <div className="space-y-6">
        <div className="admin-card space-y-4 p-5">
          <div>
            <label htmlFor="cp-name" className="mb-1 block text-xs font-medium text-[var(--ink-70)]">
              Name
            </label>
            <input id="cp-name" value={name} onChange={(e) => edit(setName)(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="cp-description" className="mb-1 block text-xs font-medium text-[var(--ink-70)]">
              Description
            </label>
            <textarea
              id="cp-description"
              rows={2}
              value={description}
              onChange={(e) => edit(setDescription)(e.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--ink-08)] bg-[var(--paper)] px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-[var(--ink-70)]">Phased program</p>
              <p className="text-xs text-[var(--ink-30)]">
                {phased ? "Sequential phases, each with its own weeks." : "One week-by-week schedule."} Switching
                keeps every day.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={phased}
              aria-label="Phased program"
              onClick={togglePhased}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                phased ? "bg-[var(--blue-deep)]" : "bg-[var(--ink-08)]"
              }`}
            >
              <span
                className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  phased ? "translate-x-[1.375rem]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          {!phased && (
            <div className="max-w-[160px]">
              <label htmlFor="cp-weeks" className="mb-1 block text-xs font-medium text-[var(--ink-70)]">
                Weeks
              </label>
              <input
                id="cp-weeks"
                type="number"
                min={1}
                max={52}
                value={flatWeeks > 0 ? flatWeeks : ""}
                onChange={(e) => setScopeWeeks(null, e.target.value)}
                className={inputClass}
              />
            </div>
          )}
        </div>

        {scopes.map(({ phaseKey, phase, index, weeks, weekOffset }) => (
          <section key={phaseKey ?? "flat"} className="admin-card p-5">
            {phase && (
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-48">
                  <label
                    htmlFor={`cp-phase-${phase.key}`}
                    className="mb-1 block text-xs font-medium text-[var(--ink-70)]"
                  >
                    Phase {index + 1}
                  </label>
                  <input
                    id={`cp-phase-${phase.key}`}
                    value={phase.name}
                    onChange={(e) =>
                      edit(setPhases)(phases.map((p) => (p.key === phase.key ? { ...p, name: e.target.value } : p)))
                    }
                    className={inputClass}
                  />
                </div>
                <div className="w-24">
                  <label
                    htmlFor={`cp-phase-weeks-${phase.key}`}
                    className="mb-1 block text-xs font-medium text-[var(--ink-70)]"
                  >
                    Weeks
                  </label>
                  <input
                    id={`cp-phase-weeks-${phase.key}`}
                    type="number"
                    min={1}
                    max={52}
                    value={phase.weeks > 0 ? phase.weeks : ""}
                    onChange={(e) => setScopeWeeks(phase.key, e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => movePhase(phase.key, -1)}
                    aria-label="Move phase earlier"
                    className="admin-secondary px-3 py-2 text-xs disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === phases.length - 1}
                    onClick={() => movePhase(phase.key, 1)}
                    aria-label="Move phase later"
                    className="admin-secondary px-3 py-2 text-xs disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={phases.length === 1}
                    onClick={() => removePhase(phase.key)}
                    className="admin-secondary px-3 py-2 text-xs text-[var(--bad)] disabled:opacity-40"
                  >
                    Remove phase
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {Array.from({ length: weeks }, (_, w) => w + 1).map((week) => (
                <div key={week}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-50)]">
                    Week {week}
                  </h3>
                  <ul className="divide-y divide-[var(--ink-08)] rounded-lg border border-[var(--ink-08)]">
                    {DAYS.map((day) => {
                      const slot: Slot = { phaseKey, week, day };
                      const entry = dayAt(slot);
                      const pickOpen =
                        openForm?.kind === "pick" &&
                        sameSlot(openForm.slot, slot);
                      const moveOpen = openForm?.kind === "move" && entry && openForm.dayKey === entry.key;
                      return (
                        <li key={day} className="px-3 py-2" data-testid={`day-${index}-${week}-${day}`}>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="w-9 shrink-0 text-xs font-medium text-[var(--ink-50)]">
                              {DAY_LABEL[day]}
                            </span>
                            {program.startDate && (
                              <span className="w-12 shrink-0 text-[11px] text-[var(--ink-30)]">
                                {slotDate(program.startDate, weekOffset + week, day)}
                              </span>
                            )}
                            {entry ? (
                              <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]">
                                {entry.content.name}
                                {entry.content.kind !== "session" && (
                                  <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                    unsaved
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="flex-1 text-[var(--ink-30)]">Rest</span>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              {entry ? (
                                <>
                                  {entry.content.kind === "session" ? (
                                    <Link
                                      to={`/library/programs/${programId}/days/${entry.content.sessionId}`}
                                      className="font-medium text-[var(--ink-50)] underline hover:text-[var(--ink)]"
                                    >
                                      Edit day
                                    </Link>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => setOpenForm({ kind: "move", dayKey: entry.key })}
                                    className="font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
                                  >
                                    Move
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setOpenForm({ kind: "pick", slot, replacing: entry.key })}
                                    className="font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
                                  >
                                    Replace
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeDay(entry.key)}
                                    className="font-medium text-[var(--bad)]"
                                  >
                                    Remove
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setOpenForm({ kind: "pick", slot, replacing: null })}
                                  className="font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
                                >
                                  + Add workout
                                </button>
                              )}
                            </div>
                          </div>

                          {pickOpen && openForm?.kind === "pick" && (
                            <WorkoutPicker
                              library={libraryWorkouts}
                              shelf={shelfWorkouts}
                              replacing={openForm.replacing !== null}
                              onCancel={() => setOpenForm(null)}
                              onPick={(content) => placeDay(slot, content, openForm.replacing)}
                            />
                          )}
                          {moveOpen && entry && (
                            <MoveForm
                              from={slot}
                              scopes={scopes.map((s) => ({
                                phaseKey: s.phaseKey,
                                label: s.phase ? s.phase.name || `Phase ${s.index + 1}` : null,
                                weeks: s.weeks,
                              }))}
                              occupiedName={(target) => {
                                const other = dayAt(target);
                                return other && other.key !== entry.key ? other.content.name : null;
                              }}
                              onCancel={() => setOpenForm(null)}
                              onMove={(target) => moveDay(entry.key, target)}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}

        {phased && (
          <button type="button" onClick={addPhase} className="admin-secondary px-4 py-2 text-sm">
            + Add phase
          </button>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--ink-08)] bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-50)]">
            <span>{totalWeeks} weeks</span>
            <span>·</span>
            <span>{days.length} training days</span>
            {savedAt && !dirty && <span className="text-[var(--ink-70)]">Saved {savedAt}</span>}
          </div>
          {dirty && validationError && (
            <span className="text-xs font-medium text-[var(--bad)]">{validationError}</span>
          )}
          {saveError && <span className="text-xs font-medium text-[var(--bad)]">{saveError}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!dirty || !!validationError || save.isPending}
              className="admin-primary px-4 py-2 text-sm disabled:opacity-40"
            >
              {save.isPending ? "Saving…" : "Save program"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PickableWorkout {
  id: string;
  name: string;
}

function WorkoutPicker({
  library,
  shelf,
  replacing,
  onPick,
  onCancel,
}: {
  library: PickableWorkout[];
  shelf: PickableWorkout[];
  replacing: boolean;
  onPick: (content: EditorDayContent) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState("");
  const [blankName, setBlankName] = useState("");
  const byId = new Map([...library, ...shelf].map((w) => [w.id, w]));
  const canAdd = choice === "__blank__" ? blankName.trim() !== "" : byId.has(choice);

  function submit() {
    if (choice === "__blank__") onPick({ kind: "blank", name: blankName.trim() });
    else {
      const w = byId.get(choice);
      if (w) onPick({ kind: "workout", workoutId: w.id, name: w.name });
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-[var(--paper)] p-3">
      {replacing && (
        <p className="text-xs text-[var(--ink-50)]">
          Replacing swaps in a fresh copy — this day&apos;s current exercises and edits are discarded on save.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Workout"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="min-w-0 flex-1 basis-56 rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm"
        >
          <option value="">Choose a workout…</option>
          <option value="__blank__">Blank day (build it in the day editor)</option>
          {shelf.length > 0 && (
            <optgroup label="This client's workouts">
              {shelf.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Library">
            {library.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </optgroup>
        </select>
        {choice === "__blank__" && (
          <input
            aria-label="Day name"
            value={blankName}
            onChange={(e) => setBlankName(e.target.value)}
            placeholder="e.g. Mobility"
            className="min-w-0 flex-1 basis-40 rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm"
          />
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canAdd}
          onClick={submit}
          className="admin-primary px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {replacing ? "Replace" : "Add"}
        </button>
        <button type="button" onClick={onCancel} className="admin-secondary px-3 py-1.5 text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}

function MoveForm({
  from,
  scopes,
  occupiedName,
  onMove,
  onCancel,
}: {
  from: Slot;
  scopes: { phaseKey: string | null; label: string | null; weeks: number }[];
  occupiedName: (target: Slot) => string | null;
  onMove: (target: Slot) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState<Slot>(from);
  const scope = scopes.find((s) => s.phaseKey === target.phaseKey) ?? scopes[0]!;
  const occupant = occupiedName(target);
  const selectClass = "rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm";

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-[var(--paper)] p-3">
      <div className="flex flex-wrap gap-2">
        {scopes.length > 1 && (
          <select
            aria-label="Phase"
            value={target.phaseKey ?? ""}
            onChange={(e) => setTarget({ ...target, phaseKey: e.target.value, week: 1 })}
            className={selectClass}
          >
            {scopes.map((s, i) => (
              <option key={s.phaseKey ?? i} value={s.phaseKey ?? ""}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Week"
          value={target.week}
          onChange={(e) => setTarget({ ...target, week: Number(e.target.value) })}
          className={selectClass}
        >
          {Array.from({ length: scope.weeks }, (_, w) => w + 1).map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
        <select
          aria-label="Day"
          value={target.day}
          onChange={(e) => setTarget({ ...target, day: e.target.value as DayOfWeek })}
          className={selectClass}
        >
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {DAY_LABEL[d]}
            </option>
          ))}
        </select>
      </div>
      {occupant && <p className="text-xs text-[var(--ink-50)]">That day has &ldquo;{occupant}&rdquo; — they&apos;ll swap.</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={sameSlot(target, from)}
          onClick={() => onMove(target)}
          className="admin-primary px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {occupant ? "Swap" : "Move"}
        </button>
        <button type="button" onClick={onCancel} className="admin-secondary px-3 py-1.5 text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}
