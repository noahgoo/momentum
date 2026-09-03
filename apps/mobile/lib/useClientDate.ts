import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { clientDateStr, clientToday } from "@momentum/shared";
import { useAuth } from "./auth";

/**
 * "Today" for the signed-in client, in THEIR timezone.
 *
 * Always use this instead of `dateStr(new Date())` for anything that means
 * a calendar day — log dates, goal dates, streak boundaries. The device
 * clock and `profiles.timezone` disagree while travelling before the sync
 * lands, and a write keyed on the wrong one lands on the wrong day.
 * See docs/rules/concurrency.md C1.
 *
 * Recomputes on app foreground so a session left open overnight (or across
 * a flight) rolls over rather than serving a stale date.
 */
export function useClientDate() {
  const { profile } = useAuth();
  const timezone = profile?.timezone ?? null;

  const [today, setToday] = useState(() => clientToday(timezone));

  useEffect(() => {
    setToday(clientToday(timezone));

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setToday(clientToday(timezone));
    });
    return () => subscription.remove();
  }, [timezone]);

  /** The calendar date of an arbitrary instant, in the client's timezone. */
  const toClientDate = useCallback((at: Date) => clientDateStr(timezone, at), [timezone]);

  return { today, timezone, toClientDate };
}
