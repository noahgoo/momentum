import { NavLink } from "react-router";
import type { NavChild } from "../lib/navigation";

/**
 * The horizontal strip of a section's sub-pages, shown at the top of every
 * page in that section. Kept out of the sidebar deliberately: an expanding
 * sidebar tree puts the app back at a dozen visible rows, while this costs
 * nothing until you are already inside the section.
 */
export function SectionNav({ title, items }: { title: string; items: NavChild[] }) {
  return (
    <div className="mb-8 border-b border-[var(--ink-08)]">
      <h1 className="font-display text-2xl text-[var(--ink)]">{title}</h1>
      <nav className="mt-4 flex gap-6">
        {items.map(({ Icon, ...child }) => (
          <NavLink
            key={child.to}
            to={child.to}
            className={({ isActive }) =>
              `-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm transition-colors ${
                isActive
                  ? "border-[var(--ink)] font-medium text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-50)] hover:text-[var(--ink)]"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={15} strokeWidth={isActive ? 2.3 : 1.8} />
                {child.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
