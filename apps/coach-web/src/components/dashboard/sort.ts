import type { ClientSummary } from "@momentum/shared";

export type SortKey = "attention" | "name" | "streak";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "attention", label: "Attention" },
  { key: "name", label: "Name" },
  { key: "streak", label: "Streak" },
];

/**
 * Attention score: unread messages and an outstanding scheduled-but-not-done
 * workout both push a client to the top; disabled clients always sink to the
 * bottom regardless of the rest of their state.
 */
function attentionScore(c: ClientSummary): number {
  if (c.disabled) return -1;
  let score = 0;
  if (c.unread_for_coach) score += 100;
  if (c.has_program && !c.workout_done) score += 10;
  return score;
}

/**
 * Sorts a `client_summaries` list for the dashboard grid. Pure function so it
 * can be re-applied on every realtime cache update without extra state.
 */
export function sortClientSummaries(rows: ClientSummary[], sort: SortKey): ClientSummary[] {
  const list = [...rows];

  if (sort === "name") {
    list.sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));
    return list;
  }

  if (sort === "streak") {
    list.sort((a, b) => {
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      return b.streak - a.streak;
    });
    return list;
  }

  // attention (default)
  list.sort((a, b) => {
    const sa = attentionScore(a);
    const sb = attentionScore(b);
    if (sa !== sb) return sb - sa;
    return b.streak - a.streak;
  });
  return list;
}
