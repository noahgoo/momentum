interface StatTileProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "default" | "ok" | "warn";
}

const ACCENT_CLASSES: Record<NonNullable<StatTileProps["accent"]>, string> = {
  default: "text-[var(--ink)]",
  ok: "text-[var(--ok)]",
  warn: "text-[var(--warn)]",
};

/** One of the 4 hero stat tiles on the coach dashboard. */
export function StatTile({ label, value, hint, accent = "default" }: StatTileProps) {
  return (
    <div className="admin-card p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-30)]">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold tracking-tight ${ACCENT_CLASSES[accent]}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-[var(--ink-30)]">{hint}</div>}
    </div>
  );
}
