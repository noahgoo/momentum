import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "./auth";
import { syncDeviceTimezone } from "./timezone";

/**
 * Fires the device -> profiles.timezone sync on sign-in and again every
 * time the app returns to the foreground (covers the user changing their
 * device timezone while the app is backgrounded, e.g. travel).
 */
export function useTimezoneSync() {
  const { session, profile } = useAuth();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (!session || !profile) return;
    void syncDeviceTimezone(session.user.id, profile.timezone);
  }, [session, profile]);

  useEffect(() => {
    if (!session) return;

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const cameToForeground = appState.current.match(/inactive|background/) && nextState === "active";
      appState.current = nextState;

      if (cameToForeground) {
        void syncDeviceTimezone(session.user.id, profile?.timezone ?? null);
      }
    });

    return () => subscription.remove();
  }, [session, profile?.timezone]);
}
