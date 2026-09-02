import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

export function SettingsPage() {
  const { profile, signOut } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Initialize display name
  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
  }, [profile?.display_name]);

  const handleDisplayNameBlur = async () => {
    if (!profile?.id || displayName === profile.display_name) {
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: displayName.trim() })
        .eq("id", profile.id);

      if (error) throw error;

      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save display name:", err);
      // Revert on error
      if (profile?.display_name) {
        setDisplayName(profile.display_name);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Profile Card */}
      <div className="admin-card p-6">
        <h2 className="mb-6 text-sm font-semibold text-[var(--ink)]">Profile</h2>

        <div className="space-y-4">
          {/* Display Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-50)]">
              Display Name
            </label>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={handleDisplayNameBlur}
                disabled={isSaving}
                className="flex-1 rounded-lg border border-[var(--ink-08)] bg-white px-4 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] disabled:opacity-50"
              />
              {isSaved && <span className="text-sm text-[var(--ok)]">Saved ✓</span>}
            </div>
          </div>

          {/* Email (Read-only) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-50)]">
              Email
            </label>
            <div className="mt-2 rounded-lg border border-[var(--ink-08)] bg-[var(--cream)] px-4 py-2 text-sm text-[var(--ink)]">
              {profile?.email || "—"}
            </div>
          </div>

          {/* Timezone (Read-only) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-50)]">
              Timezone
            </label>
            <div className="mt-2 rounded-lg border border-[var(--ink-08)] bg-[var(--cream)] px-4 py-2 text-sm text-[var(--ink)]">
              {profile?.timezone ? `${profile.timezone} (Detected automatically)` : "Not set"}
            </div>
          </div>
        </div>
      </div>

      {/* Sign Out Card */}
      <div className="admin-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">Account</h2>
        <button
          onClick={handleSignOut}
          className="rounded-lg bg-[var(--bad)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-opacity-90"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
