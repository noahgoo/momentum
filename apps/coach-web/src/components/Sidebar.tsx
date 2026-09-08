import { LogOut } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../lib/auth";
import { NAV_ITEMS, sectionForPath } from "../lib/navigation";
import { useInboxCount } from "../queries/useInboxCount";

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const { pathname } = useLocation();
  const activeSection = sectionForPath(pathname);
  const inboxCount = useInboxCount();

  return (
    <aside className="flex h-dvh w-56 shrink-0 flex-col border-r border-[var(--ink-08)] bg-white">
      <div className="border-b border-[var(--ink-08)] px-6 py-6">
        <span className="font-display text-lg text-[var(--ink)]">Momentum</span>
        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--ink-30)]">
          Coach Portal
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map(({ Icon, ...item }) => {
          const isActive = activeSection?.label === item.label;
          const count = item.badge === "inbox" ? inboxCount : 0;

          return (
            <Link
              key={item.label}
              to={item.to}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 border-l-2 py-2.5 pl-4 pr-3 text-sm transition-colors ${
                isActive
                  ? "border-[var(--ink)] font-medium text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-50)] hover:text-[var(--ink)]"
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

      <div className="border-t border-[var(--ink-08)] px-6 py-4">
        {profile?.email && (
          <p className="truncate pb-1.5 text-xs text-[var(--ink-30)]">{profile.email}</p>
        )}
        <button
          onClick={() => void signOut()}
          className="flex items-center gap-3 text-sm text-[var(--ink-50)] transition-colors hover:text-[var(--ink)]"
        >
          <LogOut size={16} strokeWidth={1.8} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
