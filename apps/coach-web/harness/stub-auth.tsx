import type { ReactNode } from "react";
import type { Profile } from "@momentum/shared";

/**
 * Replaces src/lib/auth.tsx. The real one asks Supabase for a session, which
 * the harness has no credentials for, and RequireAuth would bounce every route
 * to /login.
 */

export const HARNESS_COACH_ID = "coach-1";

const profile = {
  id: HARNESS_COACH_ID,
  email: "coach1@momentum.test",
  display_name: "Dana Whitfield",
  role: "coach",
  timezone: "America/New_York",
} as unknown as Profile;

export function useAuth() {
  return {
    loading: false,
    session: { user: { id: HARNESS_COACH_ID } },
    profile,
    rejectedReason: null,
    signIn: async () => ({ error: null }),
    signOut: async () => {},
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
