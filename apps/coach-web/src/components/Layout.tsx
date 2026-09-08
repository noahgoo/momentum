import { Outlet, useLocation } from "react-router";
import { sectionForPath, showsSectionNav } from "../lib/navigation";
import { SectionNav } from "./SectionNav";
import { Sidebar } from "./Sidebar";

export function Layout() {
  const { pathname } = useLocation();
  const section = sectionForPath(pathname);

  return (
    // h-dvh + overflow-hidden makes `main` the only scrolling element, so the
    // sidebar stays put instead of scrolling off with the page.
    <div className="flex h-dvh overflow-hidden bg-[var(--cream)]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        {section?.children && showsSectionNav(pathname, section) && (
          <SectionNav title={section.label} items={section.children} />
        )}
        <Outlet />
      </main>
    </div>
  );
}
