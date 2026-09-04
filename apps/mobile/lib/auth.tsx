import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "@momentum/shared";
import { supabase } from "./supabase";
import { unregisterPushToken } from "./pushToken";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Populated when auth rejects the account (e.g. coach role on mobile). */
  error: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const COACH_REJECTION_MESSAGE = "This is the client app. Use the coach web portal to sign in.";

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfileForSession(nextSession: Session | null) {
      if (!nextSession) {
        if (!cancelled) {
          setProfile(null);
          setError(null);
          setLoading(false);
        }
        return;
      }

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", nextSession.user.id)
        .single();

      if (cancelled) return;

      if (profileError || !data) {
        setProfile(null);
        setError(profileError?.message ?? "Could not load profile.");
        setLoading(false);
        return;
      }

      if (data.role === "coach") {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        setError(COACH_REJECTION_MESSAGE);
        setLoading(false);
        return;
      }

      setProfile(data);
      setError(null);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      void loadProfileForSession(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setLoading(true);
      void loadProfileForSession(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signOut = useMemo(
    () => async () => {
      // Before the session goes: a signed-out phone must stop receiving the
      // previous user's reminders (N2).
      await unregisterPushToken();
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      setError(null);
    },
    []
  );

  const value = useMemo<AuthContextValue>(
    () => ({ session, profile, loading, error, signOut }),
    [session, profile, loading, error, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
