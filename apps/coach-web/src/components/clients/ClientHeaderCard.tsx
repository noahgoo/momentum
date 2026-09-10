import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Profile } from "@momentum/shared";
import { avatarInitial } from "../dashboard/format";
import type { ProgramStatus } from "../../queries/useClientDetail";
import { useSendPasswordReset } from "../../queries/useClientDetail";

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
 * height/sex, program status, and the primary actions row.
 *
 * The account menu offers password reset only. Resend invite needs an Edge
 * Function to mint the signup link (still post-MVP, same reason as
 * ClientsPage's InviteClientStub), and a menu item that silently does nothing
 * is worse than an absent one.
 */
export function ClientHeaderCard({ profile, streak, programStatus, onToggleDisabled, togglePending }: Props) {
  const height = formatHeight(profile.height_in);
  const sendReset = useSendPasswordReset();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  // Only an instance program (client_id set) is safe to edit from here —
  // editing the coach's template would reach every other assigned client.
  const editableProgram =
    programStatus.kind !== "none" && programStatus.program.client_id ? programStatus.program : null;

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
              {programStatus.progressPercent != null && (
                <>
                  {" · "}
                  {programStatus.progressPercent}% complete
                </>
              )}
            </p>
          )}
        </div>

        {!profile.disabled && profile.email && (
          <div ref={menuRef} className="relative flex-none">
            <button
              type="button"
              aria-label="Account emails"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={sendReset.isPending}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-50)] transition hover:bg-[var(--cream)] hover:text-[var(--ink)] disabled:opacity-40"
            >
              {sendReset.isPending ? (
                <span className="text-xs">…</span>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2.5" />
                  <path d="m3.5 7 8.5 6 8.5-6" />
                </svg>
              )}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-10 z-10 w-56 rounded-xl border border-[var(--ink-08)] bg-white py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    sendReset.mutate(profile.email as string);
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-[var(--ink)] transition hover:bg-[var(--cream)]"
                >
                  Send password reset
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-[var(--ink-08)] pt-5">
        <Link
          to={`/inbox/messages?client=${profile.id}`}
          className="admin-secondary px-4 py-2 text-sm"
        >
          Message
        </Link>
        <Link
          to={`/assign?client=${profile.id}`}
          className="admin-primary px-4 py-2 text-sm"
        >
          {programStatus.kind === "none" ? "Assign program" : "Change program"}
        </Link>
        {editableProgram && (
          <Link
            to={`/library/programs/${editableProgram.id}`}
            className="admin-secondary px-4 py-2 text-sm"
          >
            Edit program
          </Link>
        )}
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
          className={`rounded-[var(--radius-control)] border px-4 py-2 text-sm font-semibold transition disabled:opacity-40 ${
            profile.disabled
              ? "border-[var(--ok)] text-[var(--ok)] hover:bg-[var(--ok)]/10"
              : "border-[var(--bad)] text-[var(--bad)] hover:bg-[var(--bad)]/10"
          }`}
        >
          {togglePending ? "Working…" : profile.disabled ? "Enable client" : "Disable client"}
        </button>
      </div>

      {sendReset.isSuccess && (
        <p className="mt-3 text-sm text-[var(--ok)]">Reset email sent to {profile.email}</p>
      )}
      {sendReset.isError && (
        <p className="mt-3 text-sm text-[var(--bad)]">Couldn’t send the reset email. Try again.</p>
      )}
    </div>
  );
}
