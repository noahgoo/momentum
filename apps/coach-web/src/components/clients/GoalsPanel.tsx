import { useId, useState, type FormEvent } from "react";
import type { Goal } from "@momentum/shared";
import { dayCompletion, getLast7Dates, goalsForDate, rangeCompletion } from "../../lib/goalHistory";
import {
  useArchiveClientGoal,
  useClientGoals,
  useCreateClientGoal,
  useToggleGoalLock,
} from "../../queries/useClientGoals";

interface Props {
  clientId: string;
  coachId: string;
}

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function dayLetter(dateStr: string): string {
  return DAY_LETTERS[new Date(dateStr + "T12:00:00").getDay()] ?? "";
}

function formatDayFull(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function LockIcon({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="7" width="10" height="8" rx="1.5" fill="#404040" />
        <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#404040" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="7" width="10" height="8" rx="1.5" fill="none" stroke="#c0b8ae" strokeWidth="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0" stroke="#c0b8ae" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Goals management panel for the coach client-detail page. Ported from the
 * old app's inline goals section in `src/app/admin/clients/[id]/page.tsx`
 * (weekly bar chart + day drill-down logic unchanged; lock/archive wired to
 * Postgres mutations instead of Firestore service calls).
 *
 * Constraint #6 (plan finding): goals are soft-archived only — the archive
 * action here never deletes a row, and the archived list at the bottom stays
 * visible (collapsed count) with its historical completion count intact.
 */
export function GoalsPanel({ clientId, coachId }: Props) {
  const { data, isLoading } = useClientGoals(clientId);
  const createGoal = useCreateClientGoal(clientId);
  const toggleLock = useToggleGoalLock(clientId);
  const archiveGoal = useArchiveClientGoal(clientId);

  const [newGoalText, setNewGoalText] = useState("");
  const [newGoalLocked, setNewGoalLocked] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const inputId = useId();

  if (isLoading || !data) {
    return <div className="h-24 animate-pulse rounded-xl bg-[var(--ink-08)]" />;
  }

  const allGoals = data.goals;
  const weekLogs = data.weekLogs;
  const activeGoals = allGoals.filter((g) => g.active !== false);
  const archivedGoals = allGoals.filter((g) => g.active === false);
  const last7 = getLast7Dates();
  const todayStr = last7[last7.length - 1];

  async function handleAddGoal(e: FormEvent) {
    e.preventDefault();
    const text = newGoalText.trim();
    if (!text) return;
    await createGoal.mutateAsync({ text, setBy: coachId, locked: newGoalLocked });
    setNewGoalText("");
  }

  const weekRange = allGoals.length > 0 ? rangeCompletion(allGoals, weekLogs, last7) : { done: 0, total: 0 };
  const weekPct = weekRange.total > 0 ? Math.round((weekRange.done / weekRange.total) * 100) : 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--ink)]">
          Goals
          <span className="ml-2 font-normal text-[var(--ink-30)]">({activeGoals.length} active)</span>
        </h2>
        {allGoals.length > 0 && (
          <span className="text-sm font-medium text-[var(--ink-50)]">
            <span className="font-display text-lg text-[var(--ink)]">{weekPct}</span>
            <span className="text-xs text-[var(--ink-30)]">% this week</span>
          </span>
        )}
      </div>

      {/* Week bar chart */}
      {allGoals.length > 0 && (
        <div className="mb-5">
          <div className="mb-1 flex gap-1.5">
            {last7.map((date) => {
              const { done, total } = dayCompletion(allGoals, weekLogs, date);
              const fillPct = total > 0 ? (done / total) * 100 : 0;
              const isToday = date === todayStr;
              const isSelected = date === selectedDay;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedDay((d) => (d === date ? null : date))}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <div
                    className="relative w-full overflow-hidden rounded"
                    style={{
                      height: 36,
                      background: "var(--cream)",
                      border: `1px solid ${isSelected ? "var(--ink)" : isToday ? "var(--blue-deep)" : "var(--line)"}`,
                    }}
                  >
                    <div
                      className="absolute right-0 bottom-0 left-0 transition-all duration-300"
                      style={{
                        height: `${fillPct}%`,
                        background: isToday ? "var(--blue-deep)" : "var(--blue)",
                      }}
                    />
                  </div>
                  <span
                    className="text-[9px] font-semibold"
                    style={{
                      color: isSelected ? "var(--ink)" : isToday ? "var(--blue-deep)" : "var(--ink-50)",
                    }}
                  >
                    {dayLetter(date)}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedDay && (
            <div className="mt-3 border-t border-[var(--ink-08)] pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--ink-70)]">{formatDayFull(selectedDay)}</span>
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="text-base leading-none text-[var(--ink-30)] hover:text-[var(--ink-70)]"
                >
                  ×
                </button>
              </div>
              {(() => {
                const selectedDayLogs = weekLogs.filter((l) => l.date === selectedDay);
                const selectedDayGoalIds = new Set(selectedDayLogs.map((l) => l.goal_id));
                const goalsForDay = goalsForDate(allGoals, selectedDay, selectedDayGoalIds);

                if (goalsForDay.length === 0) {
                  return <p className="text-xs text-[var(--ink-30)]">No goals on this day.</p>;
                }

                return goalsForDay.map((goal) => {
                  const done = selectedDayGoalIds.has(goal.id);
                  const archived = goal.active === false;
                  const log = selectedDayLogs.find((l) => l.goal_id === goal.id);
                  const displayText = done ? (log?.goal_text ?? goal.text) : goal.text;
                  return (
                    <div key={goal.id} className="flex items-baseline gap-2 pb-1.5">
                      <span
                        className="w-3 flex-none text-[11px] font-bold"
                        style={{ color: done ? "var(--blue-deep)" : "var(--ink-30)" }}
                      >
                        {done ? "✓" : "✗"}
                      </span>
                      <span className="text-xs" style={{ color: done ? "var(--ink)" : "var(--ink-30)" }}>
                        {displayText}
                        {archived && <span className="ml-1.5 text-[var(--ink-15)] italic">archived</span>}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}

      {activeGoals.length === 0 && <p className="mb-4 text-sm text-[var(--ink-30)]">No active goals.</p>}

      <div className="mb-4 space-y-2">
        {activeGoals.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            onToggleLock={() => toggleLock.mutate({ goalId: goal.id, locked: !goal.locked })}
            onArchive={() => archiveGoal.mutate({ goalId: goal.id, archivedBy: coachId })}
          />
        ))}
      </div>

      {/* Add goal form */}
      <form onSubmit={handleAddGoal} className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          value={newGoalText}
          onChange={(e) => setNewGoalText(e.target.value)}
          placeholder="Add a goal for this client…"
          className="min-w-0 flex-1 rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
        />
        <label className="flex items-center gap-1.5 text-xs text-[var(--ink-50)]">
          <input
            type="checkbox"
            checked={newGoalLocked}
            onChange={(e) => setNewGoalLocked(e.target.checked)}
          />
          Locked
        </label>
        <button
          type="submit"
          disabled={createGoal.isPending || !newGoalText.trim()}
          className="rounded-lg bg-[var(--blue-deep)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {archivedGoals.length > 0 && (
        <div className="mt-5 border-t border-[var(--ink-08)] pt-4">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs font-semibold tracking-wider text-[var(--ink-30)] uppercase hover:text-[var(--ink-50)]"
          >
            Previously tracked ({archivedGoals.length}) {showArchived ? "▾" : "▸"}
          </button>
          {showArchived && (
            <div className="mt-2 space-y-1.5">
              {archivedGoals.map((goal) => {
                const completions = weekLogs.filter((log) => log.goal_id === goal.id).length;
                return (
                  <div
                    key={goal.id}
                    className="flex items-baseline justify-between gap-3 text-xs text-[var(--ink-30)]"
                  >
                    <span className="line-through decoration-[var(--ink-15)]">{goal.text}</span>
                    <span className="flex-none">{completions} this week</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GoalRow({
  goal,
  onToggleLock,
  onArchive,
}: {
  goal: Goal;
  onToggleLock: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--ink-08)] py-2 last:border-0">
      <button
        type="button"
        onClick={onToggleLock}
        title={goal.locked ? "Unlock goal" : "Lock goal"}
        className="flex-none transition hover:opacity-70"
      >
        <LockIcon locked={goal.locked} />
      </button>
      <span className="flex-1 text-sm text-[var(--ink)]">{goal.text}</span>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Archive "${goal.text}"? This client will no longer see it as active.`)) {
            onArchive();
          }
        }}
        className="text-xs text-[var(--ink-15)] transition hover:text-[var(--bad)]"
      >
        Archive
      </button>
    </div>
  );
}
