import { useMemo } from "react";
import { dateStr, getWorkoutIdForDate } from "@momentum/shared";
import type { AssignmentPreview, PhasePreview, ProgramPreview } from "@momentum/shared";
import type { ProgramDetail } from "../../queries/usePrograms";

/** Converts the builder's `ProgramDetail` shape into the pure-logic `ProgramPreview` shape schedule.ts expects. */
export function toProgramPreview(detail: ProgramDetail): ProgramPreview {
  const phases: PhasePreview[] | undefined = detail.phased
    ? detail.phases.map((p) => ({ id: p.id, weeks: p.weeks, weekSchedule: p.weekSchedule }))
    : undefined;

  return {
    id: detail.id,
    weeks: detail.weeks ?? 0,
    weekSchedule: detail.phased ? {} : detail.flatWeekSchedule,
    phases,
  };
}

/** Scans forward from `startDate` (inclusive) up to `maxDays` for the first date with a scheduled workout. */
function findFirstScheduledDate(
  program: ProgramPreview,
  startDateStr: string,
  maxDays = 21
): { dateStr: string; workoutId: string } | null {
  const start = new Date(`${startDateStr}T12:00:00`);
  if (Number.isNaN(start.getTime())) return null;

  const assignment: AssignmentPreview = { startDate: startDateStr, program };

  for (let offset = 0; offset < maxDays; offset++) {
    const d = new Date(start);
    d.setDate(d.getDate() + offset);
    const candidate = dateStr(d);
    const workoutId = getWorkoutIdForDate(assignment, candidate);
    if (workoutId) return { dateStr: candidate, workoutId };
  }
  return null;
}

function formatLong(dateStrValue: string): string {
  return new Date(`${dateStrValue}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface Props {
  clientName: string;
  programName: string;
  programWeeks: number | null;
  program: ProgramPreview | null;
  startDate: string;
  workoutNameById: Map<string, string>;
}

/**
 * "Ava starts Foundation (4 weeks) on Mon Sep 7 — first workout Wed" style
 * summary preview — scope item 2. Uses the shared client-side preview
 * helpers (`resolveWeekSchedule` via `getWorkoutIdForDate`) rather than
 * re-deriving schedule logic here; SQL `resolve_scheduled_workout` stays
 * authoritative at read time on the client/mobile side.
 */
export function SchedulePreview({ clientName, programName, programWeeks, program, startDate, workoutNameById }: Props) {
  const first = useMemo(() => {
    if (!program || !startDate) return null;
    return findFirstScheduledDate(program, startDate);
  }, [program, startDate]);

  if (!program || !startDate) {
    return <p className="text-sm text-[var(--ink-30)] italic">Choose a client, program, and start date to preview.</p>;
  }

  const weeksLabel = programWeeks ? `${programWeeks} week${programWeeks === 1 ? "" : "s"}` : "unknown length";
  const startLabel = formatLong(startDate);

  return (
    <p className="text-sm text-[var(--ink-70)]">
      <span className="font-medium">{clientName || "This client"}</span> starts{" "}
      <span className="font-medium">{programName || "this program"}</span> ({weeksLabel}) on {startLabel}
      {first ? (
        <>
          {" — first workout "}
          {formatLong(first.dateStr)}
          {workoutNameById.get(first.workoutId) ? ` (${workoutNameById.get(first.workoutId)})` : ""}
        </>
      ) : (
        <> — no workout scheduled in the first 3 weeks</>
      )}
      .
    </p>
  );
}
