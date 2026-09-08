import type { LucideIcon } from "lucide-react";

interface StatTileProps {
  label: string;
  /** Sits beside the label, at the label's muted weight — the number stays the loud part. */
  Icon?: LucideIcon;
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
export function StatTile({ label, Icon, value, hint, accent = "default" }: StatTileProps) {
  return (
    <div className="admin-card p-5">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-30)]">
        {Icon && <Icon size={14} strokeWidth={1.8} />}
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold tracking-tight ${ACCENT_CLASSES[accent]}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-[var(--ink-30)]">{hint}</div>}
    </div>
  );
}
