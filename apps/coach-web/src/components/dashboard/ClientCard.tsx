import { Link } from "react-router";
import type { ClientSummary } from "@momentum/shared";
import { avatarInitial, formatRelative } from "./format";

interface ClientCardProps {
  client: ClientSummary;
}

/** Today's-workout status pill: Done / pending / Rest / No program. */
function WorkoutStatusPill({ client }: { client: ClientSummary }) {
  if (!client.has_program) {
    return (
      <span className="rounded-full bg-[var(--ink-08)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-30)]">
        No program
      </span>
    );
  }
  if (!client.today_workout_name) {
    return (
      <span className="rounded-full bg-[var(--ink-08)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-50)]">
        Rest
      </span>
    );
  }
  if (client.workout_done) {
    return (
      <span className="rounded-full bg-[var(--ok)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--ok)]">
        Done ✓
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[var(--warn)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--warn)]">
      {client.today_workout_name} pending
    </span>
  );
}

/** One client tile in the dashboard grid: identity, streak, today status, goals, last message. */
export function ClientCard({ client }: ClientCardProps) {
  const goalsPct =
    client.active_goal_count > 0
      ? Math.round((client.goals_completed_today / client.active_goal_count) * 100)
      : 0;

  return (
    <Link
      to={`/clients/${client.client_id}`}
      className={`admin-card group relative block p-5 transition hover:-translate-y-0.5 hover:border-[var(--blue)] ${
        client.disabled ? "opacity-50" : ""
      }`}
    >
      {client.unread_for_coach && (
        <span
          className="absolute top-3 right-3 h-2 w-2 rounded-full bg-[var(--warn)]"
          aria-label="Unread message"
        />
      )}

      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[var(--blue)] text-base font-semibold text-white">
          {avatarInitial(client.display_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-[var(--ink)]">
              {client.display_name || "—"}
            </p>
            {client.disabled && (
              <span className="flex-none rounded-full bg-[var(--ink-08)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-50)]">
                Disabled
              </span>
            )}
          </div>
          <p className="truncate text-xs text-[var(--ink-30)]">{client.email}</p>
        </div>
        <div className="flex flex-none items-center gap-1 text-xs font-semibold text-[var(--ink-70)]">
          🔥 {client.streak}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="text-[var(--ink-50)]">Today</span>
        <WorkoutStatusPill client={client} />
      </div>

      <div className="mb-1.5 text-xs text-[var(--ink-50)]">
        {client.active_goal_count === 0 ? (
          <span className="italic text-[var(--ink-30)]">No active goals</span>
        ) : (
          <span>
            <span className="font-medium text-[var(--ink)]">{client.goals_completed_today}</span>
            <span className="text-[var(--ink-30)]">/{client.active_goal_count} goals today</span>
          </span>
        )}
      </div>
      {client.active_goal_count > 0 && (
        <div className="h-1 overflow-hidden rounded-full bg-[var(--ink-08)]">
          <div
            className="h-full rounded-full bg-[var(--blue-deep)] transition-all"
            style={{ width: `${goalsPct}%` }}
          />
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-[var(--ink-08)] pt-3 text-[11px] text-[var(--ink-30)]">
        <span>Last message {formatRelative(client.last_message_at)}</span>
        <span className="text-[var(--ink-15)] transition group-hover:text-[var(--ink-50)]">
          View →
        </span>
      </div>
    </Link>
  );
}
