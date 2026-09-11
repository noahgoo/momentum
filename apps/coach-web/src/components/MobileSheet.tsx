import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  /** Which edge the panel is anchored to: "left" for the nav drawer, "bottom" for a sheet. */
  side: "left" | "bottom";
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
}

/**
 * Backdrop + panel shell for the two below-`lg` overlays: the nav drawer and
 * the workout builder's exercise library. It owns the parts that are easy to
 * get subtly wrong twice — Escape, backdrop click, body scroll lock, a tab
 * trap, and returning focus to whatever opened it — so callers supply only
 * content.
 *
 * Deliberately `lg:hidden`. Both call sites keep their desktop layout intact
 * (a permanent sidebar, a 360px library rail), so at `lg` and up this renders
 * nothing even when `open` is true and the caller does not have to think about
 * clearing the flag on resize.
 */
export function MobileSheet({ open, onClose, side, label, children }: MobileSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Read through a ref, and keep `onClose` out of the effect's deps. A caller
  // passing an inline arrow (the builder's library sheet did) would otherwise
  // restart this effect on every parent render — restoring focus to the opener
  // and then back to the panel, which yanks the caret out of the search field
  // mid-word. Correctness here should not depend on every caller remembering
  // to memoize.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // A dialog opened from inside this sheet (the builder's create-exercise
        // modal) owns Escape while it is up; closing the sheet out from under
        // it would discard whatever was typed there.
        if (!panelRef.current?.querySelector('[role="dialog"]')) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      // The opener may have unmounted (a drawer row that navigated away), so
      // only restore focus if it is still in the document.
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const panelClass =
    side === "left"
      ? "inset-y-0 left-0 w-72 max-w-[85vw] border-r border-[var(--ink-08)]"
      : "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-3xl border-t border-[var(--ink-08)] pb-[env(safe-area-inset-bottom)]";

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`absolute flex flex-col bg-white shadow-xl outline-none ${panelClass}`}
      >
        {children}
      </div>
    </div>
  );
}
