import { LogOut } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../lib/auth";
import { NAV_ITEMS, sectionForPath } from "../lib/navigation";
import { hasDrafts } from "../lib/useDraft";
import { useInboxCount } from "../queries/useInboxCount";

export interface SidebarProps {
  /**
   * Layout classes for the `<aside>`. The sidebar itself is position-neutral so
   * the same component can be the permanent desktop rail (fixed width, right
   * border, `lg:flex`) and the contents of the mobile nav drawer, rather than
   * the nav rows being forked into two files that drift apart.
   */
  className?: string;
}

export function Sidebar({ className = "" }: SidebarProps) {
  const { profile, signOut } = useAuth();
  const { pathname } = useLocation();
  const activeSection = sectionForPath(pathname);
  const inboxCount = useInboxCount();

  return (
    <aside className={`flex flex-col bg-white/95 backdrop-blur ${className}`}>
      <div className="border-b border-[var(--ink-08)] px-6 py-6">
        <span className="font-display text-lg tracking-tight text-[var(--ink)]">Momentum</span>
        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--ink-30)]">
          Coach Portal
        </p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map(({ Icon, ...item }) => {
          const isActive = activeSection?.label === item.label;
          const count = item.badge === "inbox" ? inboxCount : 0;

          return (
            <Link
              key={item.label}
              to={item.to}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--cream)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--ink-08)]"
                  : "text-[var(--ink-50)] hover:bg-[var(--cream)] hover:text-[var(--ink)]"
              }`}
            >
              {/* Weight, not color, marks the active row — same as the badge
                  being the only saturated thing in the nav. */}
              <Icon size={16} strokeWidth={isActive ? 2.3 : 1.8} />
              <span className="flex-1">{item.label}</span>
              {count > 0 && (
                <span className="min-w-5 rounded-full bg-[var(--blue-deep)] px-1.5 py-0.5 text-center text-[11px] font-medium leading-none text-white">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--ink-08)] px-3 py-4">
        {profile?.email && (
          <p className="truncate px-3 pb-1.5 text-xs text-[var(--ink-30)]">{profile.email}</p>
        )}
        <button
          onClick={() => {
            // Signing out discards this device's drafts, and the unsaved-changes
            // guard cannot warn about it — that watches anchor clicks, and this
            // is a button.
            if (
              profile &&
              hasDrafts(profile.id) &&
              !window.confirm(
                "You have unsaved work saved on this device. Signing out discards it."
              )
            ) {
              return;
            }
            void signOut();
          }}
          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-[var(--ink-50)] transition-colors hover:bg-[var(--cream)] hover:text-[var(--ink)]"
        >
          <LogOut size={16} strokeWidth={1.8} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
