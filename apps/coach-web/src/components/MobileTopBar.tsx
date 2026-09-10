import { Inbox, Menu } from "lucide-react";
import { Link } from "react-router";
import { useInboxCount } from "../queries/useInboxCount";

/**
 * Below `lg` the sidebar is an off-canvas drawer, so this bar carries the two
 * things that were always on screen with it: a way into the nav, and the
 * unread count. The badge is a link rather than a plain marker — on a phone the
 * whole reason to glance at the count is to act on it.
 */
export function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const inboxCount = useInboxCount();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--ink-08)] bg-white/95 px-4 backdrop-blur lg:hidden">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        className="-ml-2 flex h-10 w-10 items-center justify-center rounded-xl text-[var(--ink-50)] transition-colors hover:bg-[var(--cream)] hover:text-[var(--ink)]"
      >
        <Menu size={20} strokeWidth={1.8} />
      </button>

      <span className="font-display text-lg tracking-tight text-[var(--ink)]">Momentum</span>

      {inboxCount > 0 && (
        <Link
          to="/inbox/messages"
          aria-label={`${inboxCount} unread message${inboxCount === 1 ? "" : "s"}`}
          className="ml-auto flex items-center gap-1.5 rounded-full bg-[var(--blue-deep)] px-2.5 py-1.5 text-[11px] font-medium leading-none text-white"
        >
          <Inbox size={12} strokeWidth={2} />
          {inboxCount}
        </Link>
      )}
    </header>
  );
}
