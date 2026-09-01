import { useClientSummaries } from "../queries/useClientSummaries";

/**
 * Placeholder-level wiring only — proves the Wave 6 hooks type-flow end to
 * end (useClientSummaries, including its realtime subscription). The real
 * dashboard (stat tiles, client card grid, Attention sort) lands in Wave 9
 * (9.1).
 */
export function DashboardPage() {
  const { data: summaries, isLoading } = useClientSummaries();

  return (
    <div className="admin-card p-8">
      <h1 className="font-display text-2xl text-[var(--ink)]">Dashboard</h1>
      <p className="mt-2 text-sm text-[var(--ink-50)]">
        {isLoading ? "Loading clients…" : `${summaries?.length ?? 0} clients`}
      </p>
    </div>
  );
}
