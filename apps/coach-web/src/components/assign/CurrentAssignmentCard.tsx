import type { ActiveAssignmentInfo } from "../../queries/useAssign";

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Shows the selected client's existing active assignment (if any) with a
 * "this will be replaced" warning — scope item 4. Rendered above the form
 * so the coach sees what they're about to overwrite before submitting.
 */
export function CurrentAssignmentCard({ assignment }: { assignment: ActiveAssignmentInfo | null }) {
  if (!assignment) {
    return (
      <div className="admin-card p-5 text-sm text-[var(--ink-30)] italic">No active program assigned yet.</div>
    );
  }

  const { program, startDate, currentWeek } = assignment;
  const totalWeeks = program.weeks ?? null;

  return (
    <div className="admin-card border-l-4 border-l-[var(--warn)] p-5">
      <p className="text-xs font-semibold tracking-wide text-[var(--warn)] uppercase">Currently assigned</p>
      <p className="mt-1.5 text-sm text-[var(--ink)]">
        <span className="font-medium">{program.name}</span>
        {" · "}started {formatDate(startDate)}
        {currentWeek != null && (
          <>
            {" · "}Week {currentWeek}
            {totalWeeks ? ` of ${totalWeeks}` : ""}
          </>
        )}
        {currentWeek == null && <>{" · "}not started yet</>}
      </p>
      <p className="mt-2 text-sm font-medium text-[var(--bad)]">
        This will be replaced by the new assignment below.
      </p>
    </div>
  );
}
