import type { MotivationEntry, Profile } from "./domain.js";

/**
 * What the dashboard motivation card should display: either the coach's
 * weekly entry, or a per-client override set on the client's profile.
 */
export interface ResolvedMotivation {
  quote: string;
  imageUrl: string | null;
  source: "override" | "weekly";
}

/**
 * True while a client's motivation override should still display.
 *
 * `until` is inclusive — an override set to expire today still shows today —
 * and both values are YYYY-MM-DD, so a lexical compare is a date compare. A
 * null/empty `until` means the override never expires.
 *
 * `todayStr` must be the CLIENT's today (see concurrency.md C1); passing a
 * coach's or a device's date makes the override expire on the wrong day for
 * anyone in another timezone.
 */
export function isMotivationOverrideActive(
  until: string | null | undefined,
  todayStr: string
): boolean {
  if (!until || !until.trim()) return true;
  return until >= todayStr;
}

/**
 * Picks the override over the weekly entry when the client has a non-empty,
 * unexpired override quote. Returns null when there is nothing to show, so
 * the card can render an empty state rather than a blank quote.
 */
export function resolveMotivation(
  profile: Pick<
    Profile,
    "motivation_override_quote" | "motivation_override_image_url" | "motivation_override_until"
  > | null,
  weekly: MotivationEntry | null,
  todayStr: string
): ResolvedMotivation | null {
  const quote = profile?.motivation_override_quote?.trim();
  if (quote && isMotivationOverrideActive(profile?.motivation_override_until, todayStr)) {
    return {
      quote,
      imageUrl: profile?.motivation_override_image_url ?? null,
      source: "override",
    };
  }
  if (weekly?.quote) {
    return { quote: weekly.quote, imageUrl: weekly.image_url ?? null, source: "weekly" };
  }
  return null;
}
