import * as Localization from "expo-localization";
import { supabase } from "./supabase";

/**
 * Device timezone is the source of truth (plan decision: "Timezone —
 * device timezone, auto-synced"). No manual timezone picker anywhere in
 * the client UI. Called on auth and on every app foreground; only writes
 * when the value actually changed to avoid needless updates.
 */
export function getDeviceTimezone(): string | null {
  const calendars = Localization.getCalendars();
  const fromCalendars = calendars[0]?.timeZone;
  if (fromCalendars) return fromCalendars;

  // Older/edge-case fallback; `timezone` was the pre-getCalendars API.
  const legacy = (Localization as { timezone?: string }).timezone;
  return legacy ?? null;
}

export async function syncDeviceTimezone(userId: string, currentTimezone: string | null) {
  const deviceTimezone = getDeviceTimezone();
  if (!deviceTimezone) return;
  if (deviceTimezone === currentTimezone) return;

  const { error } = await supabase
    .from("profiles")
    .update({ timezone: deviceTimezone })
    .eq("id", userId);

  if (error) {
    console.warn("[timezone] failed to sync device timezone:", error.message);
  }
}
