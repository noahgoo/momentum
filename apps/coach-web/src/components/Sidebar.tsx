import { NavLink } from "react-router";
import { useAuth } from "../lib/auth";
import { NAV_ITEMS } from "../lib/navigation";

export function Sidebar() {
  const { profile, signOut } = useAuth();

  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col border-r border-[var(--ink-08)] bg-white">
      <div className="border-b border-[var(--ink-08)] px-6 py-6">
        <span className="font-display text-lg text-[var(--ink)]">Momentum</span>
        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--ink-30)]">
          Coach Portal
        </p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--cream)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--ink-08)]"
                  : "text-[var(--ink-50)] hover:bg-[var(--cream)] hover:text-[var(--ink)]"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[var(--ink-08)] px-3 py-4">
        {profile?.email && (
          <p className="truncate px-3 pb-2 text-xs text-[var(--ink-30)]">{profile.email}</p>
        )}
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center rounded-2xl px-3 py-2.5 text-sm text-[var(--ink-50)] transition-colors hover:bg-[var(--cream)] hover:text-[var(--ink)]"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
