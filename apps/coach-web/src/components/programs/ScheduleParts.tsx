import type { ReactNode } from "react";
import type { DayOfWeek } from "@momentum/shared";
import { DAYS, DAY_LABELS } from "./dayConstants";

/**
 * Presentational pieces shared by the library builder's WeekScheduleEditor and
 * the client program editor. They hold the look only: what a day or a week
 * means differs between the two (a library workout id vs. a client's own
 * session), so each caller owns its own state and rows.
 */

/** Mon–Sun pill toggles. `locked` days stay on and can't be toggled. */
export function DayPills({
  active,
  locked,
  onToggle,
}: {
  active: ReadonlySet<DayOfWeek> | DayOfWeek[];
  locked?: ReadonlySet<DayOfWeek>;
  onToggle: (day: DayOfWeek) => void;
}) {
  const isActive = (day: DayOfWeek) => (Array.isArray(active) ? active.includes(day) : active.has(day));
  return (
    <div className="flex flex-wrap gap-2">
      {DAYS.map((day) => {
        const isLocked = locked?.has(day) ?? false;
        return (
          <button
            key={day}
            type="button"
            disabled={isLocked}
            aria-pressed={isActive(day)}
            title={isLocked ? "This day has a workout" : undefined}
            onClick={() => onToggle(day)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive(day)
                ? "bg-[var(--blue-deep)] text-white"
                : "border border-[var(--ink-08)] bg-white text-[var(--ink-70)] hover:border-[var(--blue)]"
            } ${isLocked ? "cursor-not-allowed opacity-80" : ""}`}
          >
            {DAY_LABELS[day]}
          </button>
        );
      })}
    </div>
  );
}

/** One week: a titled card holding that week's day rows. */
export function WeekCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--ink-08)] bg-[var(--paper)] p-4">
      <p className="mb-3 text-xs font-semibold text-[var(--ink-50)]">{title}</p>
      {children}
    </div>
  );
}
