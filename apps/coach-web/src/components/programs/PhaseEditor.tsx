import type { DayOfWeek, Workout } from "@momentum/shared";
import type { BuilderPhase } from "../../queries/usePrograms";
import { WeekScheduleEditor } from "./WeekScheduleEditor";

export interface PhaseEditorProps {
  phase: BuilderPhase;
  workouts: Workout[];
  onChange: (updated: BuilderPhase) => void;
}

/**
 * Right-hand editor for the currently-selected phase: name, week count, and
 * the shared active-days + per-week schedule editor. `phase.weekSchedule`
 * keys are PHASE-LOCAL week numbers (1..phase.weeks) — see the numbering
 * comment in `usePrograms.ts`'s `useSaveProgram`.
 */
export function PhaseEditor({ phase, workouts, onChange }: PhaseEditorProps) {
  function toggleDay(day: DayOfWeek) {
    const nextActiveDays = phase.activeDays.includes(day)
      ? phase.activeDays.filter((d) => d !== day)
      : [...phase.activeDays, day];

    // Drop schedule entries for days no longer active, so a re-toggled day
    // doesn't resurrect a stale workout assignment.
    const cleanedSchedule = Object.fromEntries(
      Object.entries(phase.weekSchedule).map(([week, daySchedule]) => [
        week,
        Object.fromEntries(Object.entries(daySchedule).filter(([d]) => nextActiveDays.includes(d as DayOfWeek))),
      ]),
    );

    onChange({ ...phase, activeDays: nextActiveDays, weekSchedule: cleanedSchedule });
  }

  function setWeeks(raw: string) {
    const count = raw === "" ? 0 : Math.max(1, Math.min(52, Number(raw) || 0));
    // Trim schedule entries for weeks beyond the new count.
    const trimmed = Object.fromEntries(
      Object.entries(phase.weekSchedule).filter(([week]) => Number(week) <= count),
    );
    onChange({ ...phase, weeks: count, weekSchedule: trimmed });
  }

  function setWorkout(week: number, day: DayOfWeek, workoutId: string) {
    onChange({
      ...phase,
      weekSchedule: {
        ...phase.weekSchedule,
        [String(week)]: { ...phase.weekSchedule[String(week)], [day]: workoutId },
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Phase name</label>
          <input
            value={phase.name}
            onChange={(e) => onChange({ ...phase, name: e.target.value })}
            placeholder="e.g. Foundation"
            className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Weeks</label>
          <input
            type="number"
            min={1}
            max={52}
            value={phase.weeks > 0 ? phase.weeks : ""}
            onChange={(e) => setWeeks(e.target.value)}
            className="w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
          />
          {phase.weeks < 1 && <p className="mt-1 text-xs text-[var(--bad)]">Required.</p>}
        </div>
      </div>

      <WeekScheduleEditor
        weeks={phase.weeks}
        activeDays={phase.activeDays}
        weekSchedule={phase.weekSchedule}
        workouts={workouts}
        onToggleDay={toggleDay}
        onSetWorkout={setWorkout}
      />
    </div>
  );
}
