import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import type { NavChild } from "../lib/navigation";

/**
 * The horizontal strip of a section's sub-pages, shown at the top of every
 * page in that section. Kept out of the sidebar deliberately: an expanding
 * sidebar tree puts the app back at a dozen visible rows, while this costs
 * nothing until you are already inside the section.
 *
 * Library has five children, which do not fit on a phone, so below `lg` the
 * strip scrolls horizontally and bleeds to the screen edge (negative margin
 * cancelling `main`'s padding) — a tab cut off at the edge is what tells you
 * there is more to scroll to. The active tab is scrolled into view on
 * navigation, since landing on a later section (Motivation) would otherwise
 * leave it off-screen entirely, with nothing on the strip marking where you
 * are.
 */
export function SectionNav({ title, items }: { title: string; items: NavChild[] }) {
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;

    // Only ever adjusts this strip's own scrollLeft — `scrollIntoView` would
    // also scroll `main`, jumping the page on every navigation.
    const GUTTER = 16;
    const left = active.offsetLeft - nav.scrollLeft;
    const right = left + active.offsetWidth - nav.clientWidth;
    if (right > 0) nav.scrollLeft += right + GUTTER;
    else if (left < 0) nav.scrollLeft += left - GUTTER;
  }, [pathname]);

  return (
    <div className="mb-6 shrink-0 border-b border-[var(--ink-08)] lg:mb-8">
      <h1 className="font-display text-xl text-[var(--ink)] lg:text-2xl">{title}</h1>
      <nav ref={navRef} className="no-scrollbar -mx-4 mt-4 flex gap-6 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {items.map(({ Icon, ...child }) => (
          <NavLink
            key={child.to}
            to={child.to}
            className={({ isActive }) =>
              `-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-3 text-sm whitespace-nowrap transition-colors ${
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
