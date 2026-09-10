import { useEffect } from "react";
import { useLocation } from "react-router";
import { MobileSheet } from "./MobileSheet";
import { Sidebar } from "./Sidebar";

/**
 * The sidebar as an off-canvas drawer, for widths below `lg`. Same nav rows,
 * same inbox badge — only the container differs.
 */
export function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();

  // Close on navigation. Every row in here is a link, so without this the
  // drawer stays open on top of the page it just navigated to. `onClose` must
  // be referentially stable (the caller memoizes it) or this fires on every render.
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  return (
    <MobileSheet open={open} onClose={onClose} side="left" label="Navigation">
      <Sidebar className="h-full w-full" />
    </MobileSheet>
  );
}
