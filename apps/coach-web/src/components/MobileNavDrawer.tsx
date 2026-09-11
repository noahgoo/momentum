import { useEffect } from "react";
import { useLocation } from "react-router";
import { MobileSheet } from "./MobileSheet";
import { Sidebar } from "./Sidebar";

/**
 * The sidebar as an off-canvas drawer, for widths below `lg`. Same nav rows,
 * same inbox badge — only the container differs.
 */
export function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // `key`, not `pathname`. Every row in here is a link, so without this the
  // drawer stays open on top of the page it just navigated to — and keying on
  // the path misses the case where you tap the row for the page you are already
  // on, which is a real navigation with an unchanged path. React Router pushes
  // a new history entry with a fresh key either way.
  const { key } = useLocation();

  // `onClose` must be referentially stable (the caller memoizes it) or this
  // fires on every render.
  useEffect(() => {
    onClose();
  }, [key, onClose]);

  return (
    <MobileSheet open={open} onClose={onClose} side="left" label="Navigation">
      <Sidebar className="h-full w-full" />
    </MobileSheet>
  );
}
