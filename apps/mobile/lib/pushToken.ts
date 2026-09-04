import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { supabase } from "./supabase";

/**
 * Expo push token registration.
 *
 * One row per device (push_tokens), so a client with a phone and a tablet
 * gets reminded on both. The token is cleared on sign-out, and the outbox
 * consumer deletes it on a permanent send failure — an uninstalled app must
 * not be retried forever. See docs/rules/notifications.md N2/N4.
 */

/**
 * Whether the OS will actually deliver. Distinct from the in-app
 * `notifications_enabled` preference: a client who turned reminders on but
 * denied the OS prompt should be told why nothing arrives, rather than
 * hearing silence (N4).
 */
export async function getPermissionStatus(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Requests permission if it has not been decided, then stores the token.
 * Returns the permission status so the UI can explain a denial.
 *
 * Never throws: failing to register a push token must not block sign-in.
 */
export async function registerPushToken(
  userId: string
): Promise<Notifications.PermissionStatus | "unavailable"> {
  try {
    // Simulators and the web build have no push service.
    if (!Constants.isDevice) return "unavailable";

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status === "undetermined") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return status;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    if (!token) return status;

    // Upsert on the token itself: reinstalling can hand the same token to a
    // different account, and the row should follow the current one.
    const { error } = await supabase.from("push_tokens").upsert(
      {
        profile_id: userId,
        token,
        platform: Platform.OS,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" }
    );
    if (error) console.warn("[push] failed to store token:", error.message);

    return status;
  } catch (error) {
    console.warn("[push] registration failed:", error);
    return "unavailable";
  }
}

/**
 * Drops this device's token so a signed-out phone stops receiving the
 * previous user's reminders.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    if (!Constants.isDevice) return;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    if (!token) return;
    await supabase.from("push_tokens").delete().eq("token", token);
  } catch (error) {
    console.warn("[push] failed to clear token:", error);
  }
}
