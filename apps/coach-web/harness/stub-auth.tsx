import type { ReactNode } from "react";
import type { Profile } from "@momentum/shared";
import { clearDrafts } from "../src/lib/useDraft";

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
    // Mirrors the real signOut in src/lib/auth.tsx, which clears this coach's
    // drafts before ending the session. It calls the same `clearDrafts`, so the
    // checks exercise the real function and the real Sidebar prompt — but the
    // one-line call inside auth.tsx is the app's own wiring and is by
    // definition outside anything the harness can cover, since auth is exactly
    // what it replaces.
    signOut: async () => {
      clearDrafts(HARNESS_COACH_ID);
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
