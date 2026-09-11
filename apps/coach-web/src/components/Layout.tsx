import { useCallback, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { sectionForPath, showsSectionNav } from "../lib/navigation";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { MobileTopBar } from "./MobileTopBar";
import { SectionNav } from "./SectionNav";
import { Sidebar } from "./Sidebar";

export function Layout() {
  const { pathname } = useLocation();
  const section = sectionForPath(pathname);
  const [navOpen, setNavOpen] = useState(false);

  // Stable identity: MobileNavDrawer closes itself on every path change via an
  // effect keyed on this, so a new function each render would re-run it
  // constantly.
  const closeNav = useCallback(() => setNavOpen(false), []);

  return (
    // h-dvh + overflow-hidden makes `main` the only scrolling element, so the
    // sidebar stays put instead of scrolling off with the page.
    <div className="flex h-dvh overflow-hidden bg-[var(--cream)]">
      <Sidebar className="hidden h-dvh w-64 shrink-0 border-r border-[var(--ink-08)] lg:flex" />
      <MobileNavDrawer open={navOpen} onClose={closeNav} />

      {/* min-w-0 is load-bearing. A flex item defaults to min-width:auto, which
          refuses to shrink below its content, so without this one long client
          name or workout title widens the column and scrolls the whole page
          sideways on a phone. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar onMenu={() => setNavOpen(true)} />

        {/* flex-col here is what lets a full-height page (MessagesPage) claim
            the remaining space with `flex-1 min-h-0` instead of subtracting the
            chrome by hand. Ordinary pages keep their content height, since a
            column flex item's min-height is auto.
            One trap for new pages: a centred root needs `mx-auto w-full`, not
            `mx-auto` alone. A cross-axis auto margin suppresses stretch, so
            without `w-full` the page sizes to its content and overflows here
            rather than filling the column. */}
        <main className="flex flex-1 flex-col overflow-y-auto p-4 lg:p-8">
          {section?.children && showsSectionNav(pathname, section) && (
            <SectionNav title={section.label} items={section.children} />
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
