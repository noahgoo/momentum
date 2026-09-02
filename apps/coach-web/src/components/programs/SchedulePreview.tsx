import { useState } from "react";
import type { ProgramPreview, Workout } from "@momentum/shared";
import { resolveWeekSchedule } from "@momentum/shared";
import { DAYS, DAY_LABELS } from "./dayConstants";

export interface SchedulePreviewProps {
  program: ProgramPreview;
  workouts: Workout[];
}

/**
 * Collapsed-by-default "Preview schedule" panel. Renders the FLATTENED
 * global-week schedule via the shared `resolveWeekSchedule` helper — the
 * same function used to preview client-side workout resolution — so a
 * coach can visually confirm the builder's phased/flat input produces the
 * global week -> day -> workout table that `resolve_scheduled_workout`
 * (SQL, authoritative) would resolve against.
 */
export function SchedulePreview({ program, workouts }: SchedulePreviewProps) {
  const [open, setOpen] = useState(false);
  const workoutNameById = new Map(workouts.map((w) => [w.id, w.name]));

  const globalSchedule = resolveWeekSchedule(program);
  const weekNumbers = Object.keys(globalSchedule)
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);

  return (
    <div className="rounded-xl border border-[var(--ink-08)] bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--ink-70)]"
      >
        <span>Preview schedule</span>
        <span className="text-xs text-[var(--ink-30)]">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--ink-08)] px-4 py-3">
          {weekNumbers.length === 0 ? (
            <p className="text-xs italic text-[var(--ink-30)]">
              Nothing scheduled yet — add active days and assign workouts to see the preview.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[var(--ink-30)]">
                    <th className="py-1 pr-3 font-medium">Week</th>
                    {DAYS.map((day) => (
                      <th key={day} className="py-1 pr-3 font-medium">
                        {DAY_LABELS[day]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekNumbers.map((week) => {
                    const daySchedule = globalSchedule[String(week)] ?? {};
                    return (
                      <tr key={week} className="border-t border-[var(--ink-08)]">
                        <td className="py-1.5 pr-3 font-medium text-[var(--ink-70)]">{week}</td>
                        {DAYS.map((day) => {
                          const workoutId = daySchedule[day];
                          const label = workoutId ? workoutNameById.get(workoutId) ?? "Deleted workout" : "—";
                          return (
                            <td key={day} className="py-1.5 pr-3 text-[var(--ink-50)]">
                              {label}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
