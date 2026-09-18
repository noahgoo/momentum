import { useState } from "react";
import type { ExerciseMode, SetConfig, WeightUnit } from "@momentum/shared";
import type { SortableDragHandleProps } from "./SortableList";
import type { BuilderExercise } from "../../queries/useWorkoutDetail";
import { NumericInput } from "./NumericInput";
import { DurationInput } from "./DurationInput";
import { convertSetConfigs, defaultSetConfig, isUntouchedRow } from "./defaultSetConfig";
import { formatDuration, formatMiles } from "../../lib/workoutFormat";

const MODE_LABELS: Record<ExerciseMode, string> = {
  reps: "Reps",
  time: "Time",
  distance: "Distance",
};

const MODES: ExerciseMode[] = ["reps", "time", "distance"];
const WEIGHT_UNITS: WeightUnit[] = ["lbs", "kg"];

/** Increments a coach can set for a "from last weight" target. */
const WEIGHT_DELTAS = [0, 2.5, 5, 10, 15, 20, -5, -10];

function formatDelta(delta: number, unit: WeightUnit): string {
  if (delta === 0) return `Hold last ${unit}`;
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${unit}`;
}

/**
 * Drops a key entirely rather than setting it to undefined. `serializeSetConfig`
 * gates on `!== undefined`, so an explicit undefined would be omitted from the
 * jsonb anyway — but leaving it on the in-memory config makes `weightDelta in
 * cfg` and Object.keys disagree with what is stored, and the SQL shape check
 * rejects a literal null. Removing it keeps the two representations identical.
 */
function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const next = { ...obj };
  delete next[key];
  return next;
}

/** Renders one set's row summary text, e.g. "3 x 10 /side · last +5 lbs". */
function prescriptionSummary(mode: ExerciseMode, configs: SetConfig[]): string {
  if (configs.length === 0) return "—";
  const format = (cfg: SetConfig) =>
    mode === "time" ? formatDuration(cfg.seconds) : mode === "distance" ? formatMiles(cfg.miles) : String(cfg.reps ?? "-");
  const first = format(configs[0]!);
  const uniform = configs.every((cfg) => format(cfg) === first);
  const base = uniform ? `${configs.length} x ${first}` : `${configs.length} sets (mixed)`;

  const perSide = mode === "reps" && configs.some((cfg) => cfg.perSide);
  const delta = configs[0]?.weightDelta;
  const unit = configs[0]?.weightUnit ?? "lbs";

  return [
    perSide ? `${base} /side` : base,
    delta !== undefined ? `last ${formatDelta(delta, unit)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface ExerciseRowProps {
  item: BuilderExercise;
  index: number;
  dragHandleProps: SortableDragHandleProps;
  onChange: (next: BuilderExercise) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/**
 * One exercise row in the workout builder's left panel: a collapsed summary
 * (sets x prescription, rest, notes badge) that expands into the full editor
 * — measure-by toggle, weight-unit toggle, per-set grid, rest/notes fields.
 * Drag handle is a dedicated grip button wired via `dragHandleProps` from
 * `SortableList`, kept separate from the row body so clicking Edit/Duplicate/
 * Remove or typing in a field never starts a drag gesture.
 */
export function ExerciseRow({ item, index, dragHandleProps, onChange, onDuplicate, onRemove }: ExerciseRowProps) {
  const [expanded, setExpanded] = useState(false);
  const configs = item.setConfigs;
  const unit: WeightUnit = configs[0]?.weightUnit ?? "lbs";
  const perSide = configs.some((cfg) => cfg.perSide);
  const weightDelta = configs[0]?.weightDelta;
  const usesIncrement = weightDelta !== undefined;

  function updateSet(setIdx: number, patch: Partial<SetConfig>) {
    onChange({
      ...item,
      setConfigs: configs.map((cfg, i) => (i === setIdx ? { ...cfg, ...patch } : cfg)),
    });
  }

  function addSet() {
    const template = configs[configs.length - 1] ?? defaultSetConfig(item.mode, unit);
    onChange({ ...item, setConfigs: [...configs, { ...template }] });
  }

  function removeSet(setIdx: number) {
    if (configs.length <= 1) return;
    onChange({ ...item, setConfigs: configs.filter((_, i) => i !== setIdx) });
  }

  function changeMode(nextMode: ExerciseMode) {
    if (nextMode === item.mode) return;
    if (!isUntouchedRow(item.mode, configs)) {
      const ok = window.confirm(
        "Switching how this exercise is measured will reset the entered sets to defaults. Continue?",
      );
      if (!ok) return;
    }
    onChange({ ...item, mode: nextMode, setConfigs: convertSetConfigs(configs, item.mode, nextMode) });
  }

  function changeWeightUnit(nextUnit: WeightUnit) {
    onChange({
      ...item,
      setConfigs: configs.map((cfg) => ({ ...cfg, weightUnit: nextUnit })),
    });
  }

  // Per-exercise in the UI, per-set in storage — the same shape as the weight
  // unit above. No real exercise is unilateral for only set 2.
  function changePerSide(next: boolean) {
    onChange({
      ...item,
      setConfigs: configs.map((cfg) => (next ? { ...cfg, perSide: true } : omit(cfg, "perSide"))),
    });
  }

  /**
   * Toggling the increment on/off only ever touches `weightDelta`. The fixed
   * `weight` is deliberately left alone: the delta takes precedence while it
   * is set, so the coach's original number survives any amount of flipping —
   * including across a save — and comes back untouched when they turn it off.
   */
  function changeWeightDelta(next: number | undefined) {
    onChange({
      ...item,
      setConfigs: configs.map((cfg) =>
        next === undefined
          ? omit(cfg, "weightDelta")
          // P6: a delta is a weight too, so its unit must travel with it.
          : { ...cfg, weightDelta: next, weightUnit: cfg.weightUnit ?? unit },
      ),
    });
  }

  const notesLabel = item.notes?.trim() ? "notes" : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--ink-08)] bg-white">
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          ref={dragHandleProps.setActivatorNodeRef}
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
          className="-my-1 -ml-2 flex h-10 w-10 flex-none items-center justify-center cursor-grab text-[var(--ink-30)] hover:text-[var(--ink-50)] active:cursor-grabbing lg:-ml-0 lg:mt-1 lg:h-auto lg:w-auto lg:items-start"
          aria-label="Drag to reorder"
        >
          <GripIcon />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--ink-08)] bg-[var(--paper)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-50)]">
              {index + 1}
            </span>
            <h3 className="truncate text-sm font-semibold text-[var(--ink)]">
              {item.exerciseName || "Untitled exercise"}
            </h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ink-50)]">
            <span>{prescriptionSummary(item.mode, configs)}</span>
            {item.restSeconds != null && (
              <>
                <span>·</span>
                <span>{item.restSeconds}s rest</span>
              </>
            )}
            {item.mode !== "reps" && (
              <span className="rounded-full border border-[var(--ink-08)] bg-[var(--paper)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-50)]">
                {MODE_LABELS[item.mode].toLowerCase()}
              </span>
            )}
            {notesLabel && (
              <span className="rounded-full bg-[var(--blue)]/25 px-2 py-0.5 text-[10px] font-semibold text-[var(--blue-deep)]">
                {notesLabel}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="rounded-xl border border-[var(--ink-08)] px-2.5 py-1.5 text-xs font-medium text-[var(--ink-50)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
          >
            {expanded ? "Close" : "Edit"}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            aria-label="Duplicate exercise"
            className="rounded-xl p-2 text-[var(--ink-50)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove exercise"
            className="rounded-xl p-2 text-[var(--ink-30)] hover:bg-red-50 hover:text-[var(--bad)]"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--ink-08)] bg-[var(--paper)]/60 px-4 pb-4 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--ink-50)]">Measure by</span>
            <div className="flex overflow-hidden rounded-lg border border-[var(--ink-08)] bg-white">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => changeMode(m)}
                  aria-pressed={item.mode === m}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    item.mode === m ? "bg-[var(--ink)] text-white" : "bg-white text-[var(--ink-50)] hover:bg-[var(--paper)]"
                  }`}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {item.mode !== "distance" && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--ink-50)]">Weight unit</span>
              <div className="flex overflow-hidden rounded-lg border border-[var(--ink-08)] bg-white">
                {WEIGHT_UNITS.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => changeWeightUnit(u)}
                    aria-pressed={unit === u}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      unit === u ? "bg-[var(--ink)] text-white" : "bg-white text-[var(--ink-50)] hover:bg-[var(--paper)]"
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          {item.mode === "reps" && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--ink-50)]">Each side</span>
              <button
                type="button"
                role="switch"
                aria-checked={perSide}
                aria-label="Reps are per side"
                onClick={() => changePerSide(!perSide)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  perSide ? "bg-[var(--ink)]" : "bg-[var(--ink-08)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    perSide ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          )}

          {item.mode !== "distance" && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--ink-50)]">
                Target from last weight
              </span>
              <div className="flex items-center gap-2">
                {usesIncrement && (
                  <select
                    value={String(weightDelta)}
                    onChange={(e) => changeWeightDelta(Number(e.target.value))}
                    aria-label="Increment from last weight"
                    className="rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1 text-xs outline-none focus:border-[var(--blue-deep)]"
                  >
                    {WEIGHT_DELTAS.map((d) => (
                      <option key={d} value={String(d)}>
                        {formatDelta(d, unit)}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={usesIncrement}
                  aria-label="Target from last weight"
                  onClick={() => changeWeightDelta(usesIncrement ? undefined : 5)}
                  className={`relative h-6 w-11 flex-none rounded-full transition-colors ${
                    usesIncrement ? "bg-[var(--ink)]" : "bg-[var(--ink-08)]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      usesIncrement ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {usesIncrement && (
            <p className="text-[11px] leading-snug text-[var(--ink-50)]">
              Each set targets the client&apos;s last logged weight for that set,{" "}
              {formatDelta(weightDelta!, unit).toLowerCase()}. Blank until they have logged one.
            </p>
          )}

          <div>
            <div className="mb-1.5 grid grid-cols-[32px_1fr_1fr_24px] gap-2">
              <div className="text-center text-[10px] font-semibold tracking-wider text-[var(--ink-30)]">SET</div>
              <div className="text-[10px] font-semibold tracking-wider text-[var(--ink-30)]">
                {item.mode === "time" ? "TIME" : item.mode === "distance" ? "MILES" : "REPS"}
              </div>
              <div className="text-[10px] font-semibold tracking-wider text-[var(--ink-30)]">
                {item.mode === "distance" ? "PACE / MI" : unit.toUpperCase()}
              </div>
              <div />
            </div>

            {configs.map((cfg, setIdx) => (
              <div key={setIdx} className="mb-1.5 grid grid-cols-[32px_1fr_1fr_24px] items-center gap-2">
                <div className="text-center text-xs font-medium text-[var(--ink-30)]">{setIdx + 1}</div>

                {item.mode === "time" ? (
                  <DurationInput
                    value={cfg.seconds}
                    onChange={(n) => updateSet(setIdx, { seconds: n })}
                    placeholder="0:45"
                    className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                  />
                ) : item.mode === "distance" ? (
                  <NumericInput
                    value={cfg.miles}
                    onChange={(n) => updateSet(setIdx, { miles: n })}
                    placeholder="1"
                    className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                  />
                ) : (
                  <NumericInput
                    value={cfg.reps}
                    onChange={(n) => updateSet(setIdx, { reps: n })}
                    placeholder="10"
                    className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                  />
                )}

                {item.mode === "distance" ? (
                  <DurationInput
                    value={cfg.paceSeconds}
                    onChange={(n) => updateSet(setIdx, { paceSeconds: n })}
                    placeholder="8:30"
                    className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                  />
                ) : usesIncrement ? (
                  // A per-set absolute weight means nothing while the target is
                  // relative — an editable field here would invite the coach to
                  // type a number that is silently ignored.
                  <span className="truncate rounded-lg border border-dashed border-[var(--ink-08)] bg-[var(--paper)] px-2 py-1.5 text-sm text-[var(--ink-50)]">
                    Last {formatDelta(cfg.weightDelta ?? 0, unit)}
                  </span>
                ) : (
                  <NumericInput
                    value={cfg.weight}
                    onChange={(n) => updateSet(setIdx, { weight: n })}
                    placeholder="-"
                    className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                  />
                )}

                <button
                  type="button"
                  onClick={() => removeSet(setIdx)}
                  disabled={configs.length <= 1}
                  aria-label="Remove set"
                  className="flex items-center justify-center text-[var(--ink-30)] hover:text-[var(--bad)] disabled:cursor-not-allowed disabled:opacity-20"
                >
                  <XIcon />
                </button>
              </div>
            ))}

            <button type="button" onClick={addSet} className="mt-1 text-xs font-medium text-[var(--blue-deep)] hover:underline">
              {item.mode === "distance" ? "+ Add interval" : "+ Add set"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--ink-50)]">Rest (s)</label>
              <NumericInput
                value={item.restSeconds ?? undefined}
                onChange={(n) => onChange({ ...item, restSeconds: n ?? null })}
                className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--ink-50)]">Notes</label>
              <input
                type="text"
                value={item.notes ?? ""}
                onChange={(e) => onChange({ ...item, notes: e.target.value || null })}
                placeholder="Optional"
                className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5" cy="3" r="1.2" fill="currentColor" />
      <circle cx="11" cy="3" r="1.2" fill="currentColor" />
      <circle cx="5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="11" cy="8" r="1.2" fill="currentColor" />
      <circle cx="5" cy="13" r="1.2" fill="currentColor" />
      <circle cx="11" cy="13" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
