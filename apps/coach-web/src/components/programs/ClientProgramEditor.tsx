import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { addDaysStr, type DayOfWeek } from "@momentum/shared";
import { useAuth } from "../../lib/auth";
import { draftKey, useDraft } from "../../lib/useDraft";
import { useUnsavedChangesGuard } from "../../lib/useUnsavedChangesGuard";
import { RestoreBanner } from "../builder/RestoreBanner";
import { SaveAsWorkoutDialog } from "../sessions/SaveAsWorkoutDialog";
import { useClientSummaries } from "../../queries/useClientSummaries";
import { useWorkouts } from "../../queries/useWorkouts";
import { ClientDayRow } from "./ClientDayRow";
import { PhaseListPanel } from "./PhaseListPanel";
import { DAYS, DAY_LABELS as DAY_LABEL } from "./dayConstants";
import { DayPills, WeekCard } from "./ScheduleParts";
import {
  describeSaveClientProgramError,
  useClientProgram,
  useSaveClientProgram,
  type ClientProgram,
  type EditorDayContent,
} from "../../queries/useClientProgram";


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
 * The date a slot lands on. An assignment starts on a Monday, so week n is the
 * calendar week start + 7(n-1) .. +6 and the weekday is its offset into it,
 * the same way resolve_scheduled_workout does.
 */
function slotDate(start: string, globalWeek: number, day: DayOfWeek): string {
  return DATE_FORMAT.format(parseDate(addDaysStr(start, (globalWeek - 1) * 7 + DAYS.indexOf(day))));
}

/** The inline form open under a row. Only Move has one; add/replace live in the row's dropdown. */
type OpenForm = { kind: "move"; dayKey: string };

/** "Aug 25 – Aug 31" for a program week (global week number). */
function weekRange(start: string, globalWeek: number): string {
  const first = addDaysStr(start, (globalWeek - 1) * 7);
  return `${DATE_FORMAT.format(parseDate(first))} – ${DATE_FORMAT.format(parseDate(addDaysStr(first, 6)))}`;
}

/** Key of the one scope a flat program has, in the pill-visibility map. */
const FLAT_SCOPE = "flat";

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
  const { data: clients = [] } = useClientSummaries();

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Per scope, the weekdays whose rows are shown. A view filter only: never saved. */
  const [shownDays, setShownDays] = useState<Record<string, DayOfWeek[]>>({});
  const [saveAs, setSaveAs] = useState<{ sessionId: string; name: string } | null>(null);

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
    // Start with the weekdays this program already uses, so a Mon/Wed/Fri
    // client opens to three rows a week rather than seven.
    const used: Record<string, Set<DayOfWeek>> = {};
    for (const d of program.days) (used[d.phaseId ?? FLAT_SCOPE] ??= new Set()).add(d.day);
    setShownDays(Object.fromEntries(Object.entries(used).map(([k, v]) => [k, DAYS.filter((day) => v.has(day))])));
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

  function removePhase(key: string) {
    const dropped = days.filter((d) => d.phaseKey === key);
    if (phases.length === 1) return;
    if (!confirmDrop(dropped, "Removing this phase")) return;
    edit(setPhases)(phases.filter((p) => p.key !== key));
    setDays((prev) => prev.filter((d) => d.phaseKey !== key));
    if (selectedKey === key) setSelectedKey(null);
    setOpenForm(null);
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

  /** Saves the program. Returns the re-read server copy, or null if it didn't save. */
  async function handleSave(): Promise<ClientProgram | null> {
    if (!program || validationError) return null;
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
      return null;
    }
    setSaveError(null);
    draft.clear();
    setDirty(false);
    setOpenForm(null);
    // Re-read the server copy so new days get their session ids (and so an
    // Edit link for them appears). Awaited: re-hydrating from the cached copy
    // before the refetch lands would put the pre-save program back on screen.
    const fresh = await refetch();
    setHydrated(false);
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    return fresh.data ?? null;
  }

  /**
   * Opens the day editor for a day that exists only in this edit. A day has no
   * session (so nothing to open) until the program is saved, so this saves
   * first — every pending change goes with it — then follows the new session.
   */
  async function saveThenEditDay(slot: Slot) {
    const phaseIndex = phases.findIndex((p) => p.key === slot.phaseKey);
    const fresh = await handleSave();
    if (!fresh) return;
    const created = fresh.days.find(
      (d) =>
        d.week === slot.week &&
        d.day === slot.day &&
        (slot.phaseKey === null ? d.phaseId === null : d.phaseId === (fresh.phases[phaseIndex]?.id ?? null))
    );
    if (created) navigate(`/library/programs/${programId}/days/${created.sessionId}`);
    else setSaveError("Saved, but that day couldn't be opened — reload the page and try Edit again.");
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
  const clientName = clients.find((c) => c.client_id === program.clientId)?.display_name ?? null;
  const inputClass =
    "w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]";

  const activeScope = scopes.find((s) => s.phaseKey === selectedKey) ?? scopes[0]!;
  const scopeKey = activeScope.phaseKey ?? FLAT_SCOPE;
  // Weekdays holding a workout always show (and can't be hidden); the pills
  // only add or remove EMPTY rows. A scope with no saved choice yet (a phase
  // just added, or flat <-> phased) starts with every weekday.
  const withContent = new Set(days.filter((d) => d.phaseKey === activeScope.phaseKey).map((d) => d.day));
  const chosen = shownDays[scopeKey] ?? DAYS;
  const visibleDays = DAYS.filter((d) => withContent.has(d) || chosen.includes(d));

  function toggleWeekday(day: DayOfWeek) {
    if (withContent.has(day)) return;
    const next = visibleDays.includes(day) ? visibleDays.filter((d) => d !== day) : [...visibleDays, day];
    setShownDays((prev) => ({ ...prev, [scopeKey]: DAYS.filter((d) => next.includes(d)) }));
  }

  const phaseItems = phases.map((p) => ({ id: p.key, name: p.name, weeks: p.weeks }));

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
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
          <h1 className="font-display text-2xl text-[var(--ink)]">Edit program</h1>
          {clientName && <span className="text-sm text-[var(--ink-50)]">{clientName}</span>}
        </div>
        <p className="mt-1 max-w-prose text-sm text-[var(--ink-50)]">
          This is this client&apos;s own copy. Changes here reach only them — never the template or anyone else on
          it. Past workout logs are always kept.
        </p>
      </div>

      {draft.didRestore && !dismissedRestore && (
        <RestoreBanner onDiscard={discardDraft} onDismiss={() => setDismissedRestore(true)} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <div className="min-w-0 space-y-6">
          <div className="admin-card space-y-4 p-5">
            <div>
              <label htmlFor="cp-name" className="mb-1 block text-xs font-medium text-[var(--ink-70)]">
                Program name
              </label>
              <input id="cp-name" value={name} onChange={(e) => edit(setName)(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="cp-description" className="mb-1 block text-xs font-medium text-[var(--ink-70)]">
                Description (optional)
              </label>
              <textarea
                id="cp-description"
                rows={2}
                value={description}
                onChange={(e) => edit(setDescription)(e.target.value)}
                placeholder="Brief description"
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
          </div>

          {phased && (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-50)]">Phases</h2>
                <span className="text-xs text-[var(--ink-30)]">{totalWeeks} wks total</span>
              </div>
              <PhaseListPanel
                phases={phaseItems}
                selectedId={activeScope.phaseKey}
                canRemove={phases.length > 1}
                onReorder={(next) => {
                  const byKey = new Map(phases.map((p) => [p.key, p]));
                  edit(setPhases)(next.map((item) => byKey.get(item.id)!));
                }}
                onSelect={setSelectedKey}
                onAdd={() => {
                  const key = newKey();
                  edit(setPhases)([...phases, { key, id: null, name: `Phase ${phases.length + 1}`, weeks: 4 }]);
                  setSelectedKey(key);
                }}
                onRemove={removePhase}
              />
            </div>
          )}
        </div>

        <div className="admin-card min-w-0 space-y-6 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {activeScope.phase && (
              <div className="min-w-0 sm:col-span-2">
                <label
                  htmlFor={`cp-phase-${activeScope.phase.key}`}
                  className="mb-1 block text-xs font-medium text-[var(--ink-70)]"
                >
                  Phase name
                </label>
                <input
                  id={`cp-phase-${activeScope.phase.key}`}
                  value={activeScope.phase.name}
                  onChange={(e) =>
                    edit(setPhases)(
                      phases.map((p) => (p.key === activeScope.phase!.key ? { ...p, name: e.target.value } : p))
                    )
                  }
                  className={inputClass}
                />
              </div>
            )}
            <div className="max-w-[160px]">
              <label
                htmlFor={activeScope.phase ? `cp-phase-weeks-${activeScope.phase.key}` : "cp-weeks"}
                className="mb-1 block text-xs font-medium text-[var(--ink-70)]"
              >
                Weeks
              </label>
              <input
                id={activeScope.phase ? `cp-phase-weeks-${activeScope.phase.key}` : "cp-weeks"}
                type="number"
                min={1}
                max={52}
                value={activeScope.weeks > 0 ? activeScope.weeks : ""}
                onChange={(e) => setScopeWeeks(activeScope.phaseKey, e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-[var(--ink-70)]">Training days</p>
            <DayPills active={visibleDays} locked={withContent} onToggle={toggleWeekday} />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-[var(--ink-70)]">Workout schedule</p>
            {Array.from({ length: activeScope.weeks }, (_, w) => w + 1).map((week) => (
              <WeekCard
                key={week}
                title={
                  <>
                    Week {week}
                    {program.startDate && (
                      <span className="font-normal text-[var(--ink-30)]">
                        {" "}
                        · {weekRange(program.startDate, activeScope.weekOffset + week)}
                      </span>
                    )}
                  </>
                }
              >
                <div className="space-y-2">
                  {visibleDays.map((day) => {
                    const slot: Slot = { phaseKey: activeScope.phaseKey, week, day };
                    const entry = dayAt(slot);
                    const moveOpen = openForm?.kind === "move" && entry && openForm.dayKey === entry.key;
                    const date = program.startDate ? slotDate(program.startDate, activeScope.weekOffset + week, day) : null;
                    const content = entry?.content;
                    return (
                      <ClientDayRow
                        key={day}
                        testId={`day-${activeScope.index}-${week}-${day}`}
                        label={date ? `${DAY_LABEL[day]} · ${date}` : DAY_LABEL[day]}
                        entry={content ? { name: content.name, kind: content.kind } : null}
                        library={libraryWorkouts}
                        shelf={shelfWorkouts}
                        editHref={
                          content?.kind === "session"
                            ? `/library/programs/${programId}/days/${content.sessionId}`
                            : null
                        }
                        onEditUnsaved={
                          content && content.kind !== "session" && !validationError
                            ? () => void saveThenEditDay(slot)
                            : null
                        }
                        saving={save.isPending}
                        onChoose={(next) => placeDay(slot, next, entry?.key ?? null)}
                        onRest={() => entry && removeDay(entry.key)}
                        onMove={() => entry && setOpenForm({ kind: "move", dayKey: entry.key })}
                        onSaveAsWorkout={
                          content?.kind === "session"
                            ? () => setSaveAs({ sessionId: content.sessionId, name: content.name })
                            : null
                        }
                        below={
                          moveOpen && entry ? (
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
                          ) : null
                        }
                      />
                    );
                  })}
                </div>
              </WeekCard>
            ))}
          </div>
        </div>
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

      {saveAs && (
        <SaveAsWorkoutDialog
          sessionId={saveAs.sessionId}
          defaultName={saveAs.name}
          clientId={program.clientId}
          onClose={() => setSaveAs(null)}
        />
      )}
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
