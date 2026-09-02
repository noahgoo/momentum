import type { DayOfWeek, WeekSchedule, Workout } from "@momentum/shared";
import { DAYS, DAY_LABELS } from "./dayConstants";

export interface WeekScheduleEditorProps {
  weeks: number;
  activeDays: DayOfWeek[];
  weekSchedule: WeekSchedule;
  workouts: Workout[];
  onToggleDay: (day: DayOfWeek) => void;
  onSetWorkout: (week: number, day: DayOfWeek, workoutId: string) => void;
  /** Label prefix for week cards — "Week" by default. */
  weekLabel?: string;
}

/**
 * Active-days pill toggles (mon–sun) + one card per week, each with one row
 * per active day showing a workout <select> ("Rest" = empty option). Shared
 * between the phased PhaseEditor (phase-local weeks) and flat mode
 * (program-level weeks, explicit weeks input) — the caller owns what
 * `weekSchedule` keys mean (phase-local vs. global week numbers).
 */
export function WeekScheduleEditor({
  weeks,
  activeDays,
  weekSchedule,
  workouts,
  onToggleDay,
  onSetWorkout,
  weekLabel = "Week",
}: WeekScheduleEditorProps) {
  const orderedActiveDays = DAYS.filter((d) => activeDays.includes(d));

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-xs font-medium text-[var(--ink-70)]">Active days</label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => onToggleDay(day)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                activeDays.includes(day)
                  ? "bg-[var(--blue-deep)] text-white"
                  : "border border-[var(--ink-08)] bg-white text-[var(--ink-70)] hover:border-[var(--blue)]"
              }`}
            >
              {DAY_LABELS[day]}
            </button>
          ))}
        </div>
      </div>

      {orderedActiveDays.length === 0 ? (
        <p className="text-xs italic text-[var(--ink-30)]">
          Select active days above to configure the week-by-week schedule.
        </p>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-[var(--ink-70)]">Schedule</label>
          {Array.from({ length: Math.max(weeks, 0) }, (_, i) => i + 1).map((week) => (
            <div key={week} className="rounded-xl border border-[var(--ink-08)] bg-[var(--paper)] p-4">
              <p className="mb-3 text-xs font-semibold text-[var(--ink-50)]">
                {weekLabel} {week}
              </p>
              <div className="space-y-2">
                {orderedActiveDays.map((day) => (
                  <div key={day} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-xs text-[var(--ink-30)]">{DAY_LABELS[day]}</span>
                    <select
                      value={weekSchedule[String(week)]?.[day] ?? ""}
                      onChange={(e) => onSetWorkout(week, day, e.target.value)}
                      className="flex-1 rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
                    >
                      <option value="">Rest</option>
                      {workouts.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {workouts.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          No workouts in your library yet — add some from the Workouts page first.
        </p>
      )}
    </div>
  );
}
