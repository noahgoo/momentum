import type { Profile } from "@momentum/shared";
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router";
import { supabase } from "./supabase";
import { clearDrafts } from "./useDraft";
import { syncTimezone } from "./timezone";

interface AuthState {
  /** True while the initial session/profile lookup is in flight. */
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Set once a signed-in user is rejected for having role !== 'coach'. */
  rejectedReason: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) {
    console.error("Failed to load profile", error);
    return null;
  }
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);
  // Avoids re-running profile-load/tz-sync/role-check for the same user on
  // every token-refresh tick of onAuthStateChange.
  const handledUserId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function handleSession(nextSession: Session | null) {
      if (cancelled) return;

      if (!nextSession) {
        handledUserId.current = null;
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setSession(nextSession);

      if (handledUserId.current === nextSession.user.id) {
        setLoading(false);
        return;
      }
      handledUserId.current = nextSession.user.id;

      const nextProfile = await loadProfile(nextSession.user.id);
      if (cancelled) return;

      if (!nextProfile || nextProfile.role === "client") {
        setRejectedReason("This portal is for coaches.");
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setProfile(nextProfile);
      setLoading(false);
      void syncTimezone(nextSession.user.id, nextProfile.timezone);
    }

    supabase.auth.getSession().then(({ data }) => {
      void handleSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void handleSession(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      profile,
      rejectedReason,
      async signIn(email, password) {
        setRejectedReason(null);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { error: error.message };
        return { error: null };
      },
      async signOut() {
        handledUserId.current = null;
        // Drafts are the only coach-web data that outlives a session — the
        // query cache is not persisted — so sign-out is the one place that has
        // to remove them. Leaving a half-written program readable on a shared
        // machine is not something signing out should permit. The prompt lives
        // in Sidebar, which owns the button; clearing lives here so every path
        // gets it, including the role rejection above (which has no profile,
        // and so no drafts).
        if (profile) clearDrafts(profile.id);
        await supabase.auth.signOut();
      },
    }),
    [loading, session, profile, rejectedReason],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** Route guard: redirects to /login unless a coach session is present. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--cream)] text-[var(--ink-50)]">
        Loading…
      </div>
    );
  }

  if (!session || !profile || profile.role !== "coach") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
