/** Loading placeholder shown in the grid while client_summaries is fetching. */
export function ClientCardSkeleton() {
  return (
    <div className="admin-card animate-pulse p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-11 w-11 flex-none rounded-full bg-[var(--ink-08)]" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-28 rounded bg-[var(--ink-08)]" />
          <div className="h-3 w-36 rounded bg-[var(--ink-08)]" />
        </div>
      </div>
      <div className="mb-3 h-3 rounded bg-[var(--ink-08)]" />
      <div className="mb-1.5 h-2.5 w-40 rounded bg-[var(--ink-08)]" />
      <div className="h-1 rounded-full bg-[var(--ink-08)]" />
    </div>
  );
}
