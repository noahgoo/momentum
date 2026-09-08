import { Dumbbell, Flame, MessageCircle, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { ClientCard } from "../components/dashboard/ClientCard";
import { ClientCardSkeleton } from "../components/dashboard/ClientCardSkeleton";
import { SortControl } from "../components/dashboard/SortControl";
import { sortClientSummaries, type SortKey } from "../components/dashboard/sort";
import { StatTile } from "../components/dashboard/StatTile";
import { useAuth } from "../lib/auth";
import { useClientSummaries } from "../queries/useClientSummaries";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardPage() {
  const { profile } = useAuth();
  const { data: summaries, isLoading } = useClientSummaries();
  const [sort, setSort] = useState<SortKey>("attention");

  const rows = summaries ?? [];
  const activeRows = useMemo(() => rows.filter((c) => !c.disabled), [rows]);

  const sortedRows = useMemo(() => sortClientSummaries(rows, sort), [rows, sort]);

  const totalClients = activeRows.length;
  const scheduledToday = activeRows.filter((c) => c.has_program && c.today_workout_name).length;
  const completedToday = activeRows.filter(
    (c) => c.has_program && c.today_workout_name && c.workout_done,
  ).length;
  const unreadCount = activeRows.filter((c) => c.unread_for_coach).length;
  const topStreakClient = activeRows.reduce<(typeof activeRows)[number] | null>((top, c) => {
    if (!top || c.streak > top.streak) return c;
    return top;
  }, null);

  const now = new Date();
  const firstName = profile?.display_name?.split(" ")[0] ?? "Coach";

  return (
    <div className="mx-auto max-w-7xl">
      {/* Hero */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-30)]">
          {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <h1 className="mt-1 font-display text-3xl text-[var(--ink)]">
          {greetingForHour(now.getHours())}, {firstName}
        </h1>
      </div>

      {/* Stat tiles */}
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Clients" Icon={Users} value={isLoading ? "—" : totalClients} hint="active accounts" />
        <StatTile
          label="Today's workouts"
          Icon={Dumbbell}
          value={isLoading ? "—" : `${completedToday}/${scheduledToday}`}
          hint={scheduledToday > 0 ? `${Math.round((completedToday / scheduledToday) * 100)}% complete` : "none scheduled"}
          accent={scheduledToday > 0 && completedToday === scheduledToday ? "ok" : "default"}
        />
        <StatTile
          label="Unread messages"
          Icon={MessageCircle}
          value={isLoading ? "—" : unreadCount}
          hint={unreadCount === 1 ? "client waiting" : "clients waiting"}
          accent={unreadCount > 0 ? "warn" : "default"}
        />
        <StatTile
          label="Top streak"
          Icon={Flame}
          value={isLoading ? "—" : (topStreakClient?.streak ?? 0)}
          hint={topStreakClient ? topStreakClient.display_name ?? "—" : "no clients yet"}
        />
      </div>

      {/* Section header */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-70)]">
          Clients
          {totalClients > 0 && (
            <span className="font-normal text-[var(--ink-30)]"> · {totalClients}</span>
          )}
        </h2>
        <SortControl value={sort} onChange={setSort} />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <ClientCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && sortedRows.length === 0 && (
        <div className="admin-card border border-dashed border-[var(--ink-08)] py-16 text-center">
          <p className="text-sm text-[var(--ink-50)]">No clients yet.</p>
        </div>
      )}

      {!isLoading && sortedRows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedRows.map((client) => (
            <ClientCard key={client.client_id} client={client} />
          ))}
        </div>
      )}
    </div>
  );
}
