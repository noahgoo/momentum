import { Link } from "react-router";
import type { Profile } from "@momentum/shared";
import { avatarInitial } from "../dashboard/format";
import type { ProgramStatus } from "../../queries/useClientDetail";

interface Props {
  profile: Profile;
  streak: number;
  programStatus: ProgramStatus;
  onToggleDisabled: () => void;
  togglePending: boolean;
}

function formatHeight(heightIn: number | null): string | null {
  if (heightIn == null) return null;
  const feet = Math.floor(heightIn / 12);
  const inches = Math.round(heightIn % 12);
  return `${feet}'${inches}"`;
}

/**
 * Header card for the coach client-detail page: identity, streak badge,
 * height/sex, program status, and the primary actions row. Ported from the
 * old app's inline header block — trimmed to this slice's scope (no email
 * resend menu, no super-admin delete; NON-GOALS route Message/Assign to
 * their own pages instead of opening inline here).
 */
export function ClientHeaderCard({ profile, streak, programStatus, onToggleDisabled, togglePending }: Props) {
  const height = formatHeight(profile.height_in);

  return (
    <div className="admin-card p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-[var(--blue)] text-xl font-semibold text-white">
          {avatarInitial(profile.display_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
              {profile.display_name || "—"}
            </h1>
            <span className="rounded-full bg-[var(--cream)] px-2.5 py-0.5 text-sm font-medium text-[var(--ink-70)]">
              {streak} 🔥 streak
            </span>
            {profile.disabled && (
              <span className="rounded-full bg-[var(--ink-08)] px-2.5 py-0.5 text-xs font-semibold text-[var(--ink-50)]">
                Disabled
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-[var(--ink-50)]">{profile.email}</p>
          {(height != null || profile.sex) && (
            <p className="mt-0.5 text-sm text-[var(--ink-50)]">
              {height != null && <span>{height}</span>}
              {height != null && profile.sex && " · "}
              {profile.sex && <span className="capitalize">{profile.sex}</span>}
            </p>
          )}
          {programStatus.kind === "none" && (
            <p className="mt-2 text-sm text-[var(--ink-30)] italic">No program assigned</p>
          )}
          {programStatus.kind === "not_started" && (
            <p className="mt-2 text-sm text-[var(--ink-70)]">
              <span className="font-medium">{programStatus.program.name}</span>
              {" · "}starts{" "}
              {new Date(programStatus.startDateStr + "T12:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </p>
          )}
          {programStatus.kind === "active" && (
            <p className="mt-2 text-sm text-[var(--ink-70)]">
              <span className="font-medium">{programStatus.program.name}</span>
              {" · "}Week {programStatus.currentWeek} of {programStatus.totalWeeks || "—"}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-[var(--ink-08)] pt-5">
        <Link
          to={`/messages?client=${profile.id}`}
          className="rounded-lg border border-[var(--ink-08)] px-4 py-2 text-sm font-medium text-[var(--ink-70)] hover:bg-[var(--paper)]"
        >
          Message
        </Link>
        <Link
          to={`/assign?client=${profile.id}`}
          className="rounded-lg bg-[var(--blue-deep)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {programStatus.kind === "none" ? "Assign program" : "Change program"}
        </Link>
        <button
          type="button"
          disabled={togglePending}
          onClick={() => {
            const verb = profile.disabled ? "Enable" : "Disable";
            if (
              window.confirm(
                `${verb} ${profile.display_name || "this client"}? ${
                  profile.disabled
                    ? "They will regain access to the client app."
                    : "They will be signed out and unable to log in until re-enabled."
                }`
              )
            ) {
              onToggleDisabled();
            }
          }}
          className={`rounded-xl border px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${
            profile.disabled
              ? "border-[var(--ok)] text-[var(--ok)] hover:bg-[var(--ok)]/10"
              : "border-[var(--bad)] text-[var(--bad)] hover:bg-[var(--bad)]/10"
          }`}
        >
          {togglePending ? "Working…" : profile.disabled ? "Enable client" : "Disable client"}
        </button>
      </div>
    </div>
  );
}
