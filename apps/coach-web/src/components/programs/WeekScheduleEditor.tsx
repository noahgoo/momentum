import { useMemo, useState } from "react";
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
  /**
   * When the program belongs to one client, their name — so the picker can
   * separate their own shelf from the global library. Undefined for a
   * template, where every workout is global.
   */
  clientName?: string;
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
  clientName,
}: WeekScheduleEditorProps) {
  const orderedActiveDays = DAYS.filter((d) => activeDays.includes(d));
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Facets derived from the loaded rows, the way the exercise library does it.
  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const w of workouts) if (w.category) seen.add(w.category);
    return Array.from(seen).sort();
  }, [workouts]);

  const visible = useMemo(
    () =>
      categoryFilter === "all"
        ? workouts
        : workouts.filter((w) => (w.category ?? "uncategorized") === categoryFilter),
    [workouts, categoryFilter]
  );

  // Grouped for <optgroup>. Whose shelf it is comes first when the program
  // belongs to a client — that is the distinction a coach is scanning for —
  // and category groups the rest. A native <select> is deliberate: there is
  // one per (week, day), so up to ~84 on a page, and it is the only control
  // that stays usable at 390px inside a scrolling week card.
  const groups = useMemo(() => {
    const out: { label: string; items: Workout[] }[] = [];
    if (clientName) {
      const mine = visible.filter((w) => w.client_id);
      if (mine.length > 0) out.push({ label: `${clientName}'s workouts`, items: mine });
    }
    const global = visible.filter((w) => !w.client_id);
    for (const c of categories) {
      const items = global.filter((w) => w.category === c);
      if (items.length > 0) out.push({ label: c, items });
    }
    const uncategorized = global.filter((w) => !w.category);
    if (uncategorized.length > 0) out.push({ label: "Uncategorized", items: uncategorized });
    return out;
  }, [visible, categories, clientName]);

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="block text-xs font-medium text-[var(--ink-70)]">Schedule</label>
            {categories.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter workouts by category"
                className="rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1 text-xs outline-none focus:border-[var(--blue-deep)]"
              >
                <option value="all">All categories ({workouts.length})</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c} ({workouts.filter((w) => w.category === c).length})
                  </option>
                ))}
              </select>
            )}
          </div>
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
                      {groups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.items.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </optgroup>
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
