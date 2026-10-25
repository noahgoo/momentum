/**
 * Picks a starting rest day for each workout the client wants to move, so the
 * common case ("I missed three, just fit them in") is one tap rather than
 * three date pickers.
 *
 * Pure, and a preview only: the server decides whether any of these dates is
 * actually free (move_target_problem), and a suggestion the client edits or
 * ignores is never a basis for a write. It never guesses at the schedule — it
 * only chooses among the `restDays` get_movable_days handed back.
 */

function dayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/**
 * @param sources   Workout dates being moved.
 * @param restDays  Free target days, today or later, from get_movable_days.
 * @param today     The client's today (YYYY-MM-DD).
 * @param chosen    Targets the client already picked; kept, and never handed out twice.
 */
export function suggestTargets(
  sources: string[],
  restDays: string[],
  today: string,
  chosen: Record<string, string> = {}
): Record<string, string> {
  const result: Record<string, string> = {};
  const taken = new Set(Object.values(chosen));

  for (const from of [...sources].sort()) {
    const existing = chosen[from];
    if (existing) {
      result[from] = existing;
      continue;
    }

    const free = restDays.filter((d) => !taken.has(d) && d !== from);
    if (free.length === 0) continue;

    let pick: string;
    if (from < today) {
      // A missed workout can only go forward: the soonest free day.
      pick = [...free].sort()[0]!;
    } else {
      // An upcoming one stays near where it was, preferring the later day on a tie.
      const origin = dayNumber(from);
      pick = [...free].sort((a, b) => {
        const da = Math.abs(dayNumber(a) - origin);
        const db = Math.abs(dayNumber(b) - origin);
        return da - db || (a < b ? 1 : -1);
      })[0]!;
    }

    result[from] = pick;
    taken.add(pick);
  }

  return result;
}
