import { SORT_OPTIONS, type SortKey } from "./sort";

interface SortControlProps {
  value: SortKey;
  onChange: (key: SortKey) => void;
}

/** Attention / Name / Streak segmented control for the client grid. */
export function SortControl({ value, onChange }: SortControlProps) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="mr-1 text-[var(--ink-30)]">Sort:</span>
      {SORT_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-lg px-2.5 py-1 transition-colors ${
            value === key
              ? "bg-[var(--ink)] text-white"
              : "border border-[var(--ink-08)] bg-white text-[var(--ink-50)] hover:text-[var(--ink)]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
