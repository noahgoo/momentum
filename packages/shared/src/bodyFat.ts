import type { BodyFatEntry, BodyFatProfile, Sex } from "./types.js";

/**
 * US Navy circumference method. Imperial units only (inches).
 * Male:   BF% = 86.010·log10(waist − neck) − 70.041·log10(height) + 36.76
 * Female: BF% = 163.205·log10(waist + hips − neck) − 97.684·log10(height) − 78.387
 * Accurate within ~1–3% for most people.
 * Returns null on any invalid/non-finite input or when the log10 domain would
 * be violated (difference ≤ 0), rather than NaN.
 */
export function navyBodyFatPct(input: {
  sex: Sex;
  heightIn: number;
  neckIn: number;
  waistIn: number;
  hipsIn?: number;
}): number | null {
  const { sex, heightIn, neckIn, waistIn, hipsIn } = input;

  if (
    !Number.isFinite(heightIn) ||
    !Number.isFinite(neckIn) ||
    !Number.isFinite(waistIn) ||
    heightIn <= 0
  ) {
    return null;
  }

  let result: number;
  if (sex === "male") {
    const diff = waistIn - neckIn;
    if (diff <= 0) return null;
    result = 86.010 * Math.log10(diff) - 70.041 * Math.log10(heightIn) + 36.76;
  } else {
    if (!Number.isFinite(hipsIn)) return null;
    const diff = waistIn + (hipsIn as number) - neckIn;
    if (diff <= 0) return null;
    result = 163.205 * Math.log10(diff) - 97.684 * Math.log10(heightIn) - 78.387;
  }

  if (!Number.isFinite(result) || result < 0) return null;
  return result;
}

/** Convenience wrapper: pulls sex/height from the profile, measurements from the entry. */
export function bodyFatFromEntry(
  profile: BodyFatProfile,
  entry: BodyFatEntry
): number | null {
  const { heightIn, sex } = profile;
  if (!sex || !Number.isFinite(heightIn)) return null;
  if (!Number.isFinite(entry.neckIn) || !Number.isFinite(entry.waistIn)) return null;

  return navyBodyFatPct({
    sex,
    heightIn: heightIn as number,
    neckIn: entry.neckIn as number,
    waistIn: entry.waistIn as number,
    hipsIn: entry.hipsIn,
  });
}
