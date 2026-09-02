import { useState } from "react";
import { bodyFatFromEntry } from "@momentum/shared";
import type { BodyMeasurement, Sex } from "@momentum/shared";

interface Props {
  measurements: BodyMeasurement[];
  sex: Sex | null;
  heightIn: number | null;
}

const COLLAPSED_COUNT = 8;

function measurementDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Read-only measurement history — ported from the old app's inline
 * measurements section. `bodyFatFromEntry` is the canonical shared Navy-BF%
 * implementation (packages/shared/src/bodyFat.ts); this panel never
 * recomputes the formula locally. Measurements are immutable in this app
 * (clients delete+re-add rather than edit), so there is no edit affordance
 * here — coach view is read-only per the slice spec.
 */
export function MeasurementsPanel({ measurements, sex, heightIn }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (measurements.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-[var(--ink-08)] py-10 text-center text-sm text-[var(--ink-30)]">
        No measurements yet — they&apos;ll appear here once logged
      </div>
    );
  }

  // `measurements.length === 0` returned above, so index 0 always exists here;
  // `noUncheckedIndexedAccess` can't see that through the early return.
  const latest = measurements[0]!;
  const latestBf = bodyFatFromEntry(
    { sex: sex ?? undefined, heightIn: heightIn ?? undefined },
    { neckIn: latest.neck_in ?? undefined, waistIn: latest.waist_in ?? undefined, hipsIn: latest.hips_in ?? undefined }
  );
  const visible = showAll ? measurements : measurements.slice(0, COLLAPSED_COUNT);

  return (
    <div>
      <div className="mb-5 flex gap-6 border-b border-[var(--ink-08)] pb-5">
        <div>
          <div className="text-[10px] font-semibold tracking-wider text-[var(--ink-30)]">WEIGHT</div>
          <div className="mt-1 text-lg font-medium text-[var(--ink)]">
            {latest.weight_lbs != null ? `${latest.weight_lbs} lbs` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold tracking-wider text-[var(--ink-30)]">BODY FAT</div>
          <div className="mt-1 text-lg font-medium text-[var(--ink)]">
            {latestBf != null ? `${latestBf.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold tracking-wider text-[var(--ink-30)]">WAIST</div>
          <div className="mt-1 text-lg font-medium text-[var(--ink)]">
            {latest.waist_in != null ? `${latest.waist_in} in` : "—"}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--ink-30)]">
              <th className="pr-4 pb-2 font-medium">Date</th>
              <th className="pr-4 pb-2 font-medium">Weight</th>
              <th className="pr-4 pb-2 font-medium">Waist</th>
              <th className="pr-4 pb-2 font-medium">Hips</th>
              <th className="pb-2 font-medium">BF%</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => {
              const bf = bodyFatFromEntry(
                { sex: sex ?? undefined, heightIn: heightIn ?? undefined },
                { neckIn: entry.neck_in ?? undefined, waistIn: entry.waist_in ?? undefined, hipsIn: entry.hips_in ?? undefined }
              );
              return (
                <tr key={entry.id} className="border-t border-[var(--ink-08)]">
                  <td className="py-2 pr-4 text-[var(--ink-70)]">{measurementDate(entry.date)}</td>
                  <td className="py-2 pr-4 text-[var(--ink-70)]">
                    {entry.weight_lbs != null ? `${entry.weight_lbs} lbs` : "—"}
                  </td>
                  <td className="py-2 pr-4 text-[var(--ink-70)]">
                    {entry.waist_in != null ? `${entry.waist_in} in` : "—"}
                  </td>
                  <td className="py-2 pr-4 text-[var(--ink-70)]">
                    {entry.hips_in != null ? `${entry.hips_in} in` : "—"}
                  </td>
                  <td className="py-2 text-[var(--ink-70)]">{bf != null ? `${bf.toFixed(1)}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {measurements.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs font-medium text-[var(--blue-deep)] hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${measurements.length}`}
        </button>
      )}
    </div>
  );
}
