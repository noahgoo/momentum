import { useEffect, useRef, useState } from "react";
import type { Profile } from "@momentum/shared";
import { useSaveMotivationOverride } from "../../queries/useClientDetail";

interface Props {
  profile: Profile;
  /** The CLIENT's today (YYYY-MM-DD), for the expiry hint — not the coach's. */
  todayStr: string;
}

/**
 * Per-client override for the dashboard motivation card. When the quote is
 * set and unexpired it replaces the coach-wide weekly `motivation_entries`
 * card for this one client.
 *
 * Fields seed from the profile once per client rather than on every render of
 * a fresh payload, so a background refetch can't overwrite edits in progress.
 */
export function MotivationOverridePanel({ profile, todayStr }: Props) {
  const save = useSaveMotivationOverride(profile.id);

  const [quote, setQuote] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [until, setUntil] = useState("");

  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === profile.id) return;
    seededFor.current = profile.id;
    setQuote(profile.motivation_override_quote ?? "");
    setImageUrl(profile.motivation_override_image_url ?? "");
    setUntil(profile.motivation_override_until ?? "");
  }, [profile]);

  const hasQuote = Boolean(quote.trim());
  const expired = hasQuote && Boolean(until) && until < todayStr;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ quote, imageUrl, until });
      }}
      className="max-w-lg space-y-3"
    >
      <p className="text-xs text-[var(--ink-50)]">
        Optional text and image shown to this client instead of your weekly motivation card.
        Leave the quote empty to use the weekly card.
      </p>

      <textarea
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
        rows={3}
        placeholder="Override quote (optional)"
        className="w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
      />
      <input
        type="url"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder="Image URL (optional)"
        className="w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
      />
      <label className="block">
        <span className="text-xs text-[var(--ink-50)]">Show until (optional)</span>
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="admin-primary px-4 py-2 text-sm disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save override"}
        </button>
        {save.isError && <span className="text-xs text-[var(--bad)]">Couldn’t save. Try again.</span>}
        {!save.isPending && !save.isError && expired && (
          <span className="text-xs text-[var(--ink-50)]">Expired — the weekly card is showing.</span>
        )}
        {!save.isPending && !save.isError && !hasQuote && (
          <span className="text-xs text-[var(--ink-50)]">No override — the weekly card is showing.</span>
        )}
      </div>
    </form>
  );
}
