import { useTimezoneSync } from "../lib/useTimezoneSync";

/**
 * Headless component whose only job is to invoke the timezone-sync hook
 * from inside <AuthProvider>. Kept separate from RootLayout so the hook
 * (which calls useAuth()) never runs outside the provider tree.
 */
export function TimezoneSyncGate() {
  useTimezoneSync();
  return null;
}
