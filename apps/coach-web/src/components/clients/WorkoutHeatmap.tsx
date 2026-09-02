import { parseDateStr } from "@momentum/shared";
import type { WorkoutLog } from "@momentum/shared";

interface Props {
  logs: WorkoutLog[];
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKS = 12;

/**
 * Ported from the old app's `src/components/coach/WorkoutHeatmap.tsx`
 * (Tailwind class names updated to this app's token names, logic unchanged).
 *
 * Constraint #11 (plan): day-keyed data (`workout_logs.date`) is a plain
 * YYYY-MM-DD string, not a timestamp — it must be plotted as-is via
 * `parseDateStr` rather than round-tripped through `new Date(isoString)`,
 * which would shift the calendar date under non-UTC local timezones.
 */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function WorkoutHeatmap({ logs }: Props) {
  const completedDates = new Set(logs.filter((l) => l.completed).map((l) => l.date));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonday = getMondayOfWeek(today);

  // columns[0] = oldest week, columns[WEEKS-1] = this week
  const columns: { date: Date; dateStr: string }[][] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const weekStart = new Date(thisMonday);
    weekStart.setDate(thisMonday.getDate() - w * 7);
    const days = Array.from({ length: 7 }, (_, d) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + d);
      const dateStrVal = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { date, dateStr: dateStrVal };
    });
    columns.push(days);
  }

  // Month labels: show abbreviated month when it changes between week columns.
  // Every column always has exactly 7 days (built by the fixed loop above),
  // so index 0 is always present — `!` is safe under noUncheckedIndexedAccess.
  const monthLabels: (string | null)[] = columns.map((col, i) => {
    const month = col[0]!.date.toLocaleDateString("en-US", { month: "short" });
    if (i === 0) return month;
    const prevMonth = columns[i - 1]![0]!.date.toLocaleDateString("en-US", { month: "short" });
    return month !== prevMonth ? month : null;
  });

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex gap-1.5">
        {/* Day labels column */}
        <div className="mr-0.5 flex flex-col gap-1.5 pt-5">
          {DAY_LABELS.map((label, i) => (
            <div
              key={label}
              className={`flex h-3.5 items-center text-[9px] leading-none text-[var(--ink-30)] select-none ${i % 2 === 0 ? "" : "opacity-0"}`}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Week columns */}
        {columns.map((days, wi) => (
          <div key={wi} className="flex flex-col gap-1.5">
            <div className="h-4 leading-none whitespace-nowrap text-[9px] text-[var(--ink-30)] select-none">
              {monthLabels[wi] ?? ""}
            </div>
            {days.map(({ date, dateStr: dayStr }) => {
              const isFuture = date > today;
              const done = completedDates.has(dayStr);
              const parsed = parseDateStr(dayStr) ?? date;
              return (
                <div
                  key={dayStr}
                  title={`${parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" })}${done ? " — completed" : ""}`}
                  className={[
                    "h-3.5 w-3.5 rounded-sm",
                    isFuture
                      ? "border border-[var(--ink-08)] bg-white"
                      : done
                        ? "bg-[var(--blue-deep)]"
                        : "bg-[var(--cream-deep)]/70",
                  ].join(" ")}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-3 text-[10px] text-[var(--ink-50)]">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-[var(--blue-deep)]" />
          Completed
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-[var(--cream-deep)]/70" />
          No log
        </div>
      </div>
    </div>
  );
}
