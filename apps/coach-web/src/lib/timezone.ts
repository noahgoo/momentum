import { supabase } from "./supabase";

/**
 * Syncs the browser's IANA timezone to `profiles.timezone` whenever it
 * differs from what's stored. Device timezone is the source of truth
 * (see plan decision: "Timezone — device timezone, auto-synced").
 *
 * Call once after a successful sign-in / session restore.
 */
export async function syncTimezone(userId: string, currentTimezone: string | null): Promise<void> {
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!deviceTimezone || deviceTimezone === currentTimezone) return;

  const { error } = await supabase
    .from("profiles")
    .update({ timezone: deviceTimezone })
    .eq("id", userId);

  if (error) {
    console.error("Failed to sync timezone", error);
  }
}
