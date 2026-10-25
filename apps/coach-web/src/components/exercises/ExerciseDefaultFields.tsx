import type { DistanceUnit, LoadType } from "@momentum/shared";

/** Same wording the builder uses, so a default and the row it seeds read alike. */
export const LOAD_TYPE_OPTIONS: { value: LoadType; label: string }[] = [
  { value: "total", label: "Total weight" },
  { value: "each_hand", label: "Each hand (dumbbells)" },
  { value: "bodyweight", label: "Bodyweight" },
  { value: "bodyweight_plus", label: "Bodyweight + added" },
  { value: "assisted", label: "Assisted" },
];

const SELECT_CLASS =
  "w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]";

/** What a weight on this exercise means by default. Seeds new builder rows; each prescription snapshots its own. */
export function LoadTypeSelect({
  value,
  onChange,
}: {
  value: LoadType | null;
  onChange: (next: LoadType | null) => void;
}) {
  return (
    <div className="col-span-2">
      <label className="mb-1 block text-xs text-[var(--ink-50)]">Weight means</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as LoadType | null)}
        aria-label="Default weight means"
        className={SELECT_CLASS}
      >
        <option value="">Not specified</option>
        {LOAD_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DistanceUnitSelect({
  value,
  onChange,
}: {
  value: DistanceUnit;
  onChange: (next: DistanceUnit) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as DistanceUnit)}
      aria-label="Default distance unit"
      className="rounded-lg border border-[var(--ink-08)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]"
    >
      <option value="mi">mi</option>
      <option value="km">km</option>
    </select>
  );
}
