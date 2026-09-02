import type { Goal, GoalLog } from "@momentum/shared";

/**
 * Pure goal-history helpers. Duplicated from apps/mobile/lib/goalHistory.ts
 * (itself ported from the old app's `src/lib/goalHistory.ts`) rather than
 * shared — packages/shared holds domain types/logic only, not app-layer
 * utilities, and this file has no React/RN dependency either way, so keeping
 * a byte-for-byte copy here is simpler than inventing a shared home for one
 * small module. Keep the two copies in sync by hand if the logic changes.
 *
 * Used by the client-detail Goals panel's weekly bar chart + day drill-down
 * so a day can still show a goal's completion state even after the goal has
 * since been archived (plan finding #6 — soft-archive only, never delete).
 */

/** Existence window only (no log-union). */
export function goalExistsOnDay(goal: Goal, dateStr: string): boolean {
  const createdStr = goal.created_at.slice(0, 10);
  if (createdStr > dateStr) return false;
  if (goal.archived_at) return goal.archived_at.slice(0, 10) > dateStr;
  // Legacy archived goals predate archived_at tracking and have no timestamp
  // to bound their window — treat as already archived rather than eternally
  // active, so they don't keep inflating a past day's total.
  if (goal.active === false) return false;
  return true;
}

/** Existence window ∪ goals whose id is in loggedGoalIds. Preserves input order. */
export function goalsForDate(
  goals: Goal[],
  dateStr: string,
  loggedGoalIds?: ReadonlySet<string>
): Goal[] {
  return goals.filter(
    (goal) => goalExistsOnDay(goal, dateStr) || (loggedGoalIds?.has(goal.id) ?? false)
  );
}

/**
 * { done, total } for one day: filter logs to date, build goalId set,
 * goalsForDate with it; done = counted goals with a log; orphan logs
 * (goal_id not in goals) excluded from both.
 */
export function dayCompletion(
  goals: Goal[],
  logs: GoalLog[],
  dateStr: string
): { done: number; total: number } {
  const loggedGoalIds = new Set(
    logs.filter((log) => log.date === dateStr).map((log) => log.goal_id)
  );
  const counted = goalsForDate(goals, dateStr, loggedGoalIds);
  const done = counted.filter((goal) => loggedGoalIds.has(goal.id)).length;
  return { done, total: counted.length };
}

/** Sum of dayCompletion across dates. */
export function rangeCompletion(
  goals: Goal[],
  logs: GoalLog[],
  dates: string[]
): { done: number; total: number } {
  return dates.reduce(
    (acc, dateStr) => {
      const { done, total } = dayCompletion(goals, logs, dateStr);
      return { done: acc.done + done, total: acc.total + total };
    },
    { done: 0, total: 0 }
  );
}

/** Local YYYY-MM-DD for a Date, no timezone shift (mirrors packages/shared/schedule.ts `dateStr`). */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Last 7 local dates ending today, oldest first. */
export function getLast7Dates(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return localDateStr(d);
  });
}
