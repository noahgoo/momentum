import { useCallback, useEffect, useRef } from "react";

/**
 * Warns before unsaved builder state would be left behind.
 *
 * This is a courtesy on top of the draft, not what prevents the loss — the
 * work is already in `localStorage` and comes back on return. The guard exists
 * because a coach who clicks the wrong nav row has no way of knowing that, and
 * the mobile drawer put five more tappable rows one gesture away from a
 * half-built program.
 *
 * Three exits, three mechanisms:
 *
 *  - **Reload and tab close** — `beforeunload`. The browser supplies its own
 *    wording; the string is ignored everywhere, but returning one is still
 *    what triggers the prompt.
 *  - **Clicking a link** — a capture-phase listener on `document`. React
 *    Router's `Link` renders a real anchor, so this catches the sidebar, the
 *    mobile drawer and the section nav without either knowing about it.
 *  - **The builder's own buttons** — `confirmLeave()`, which the caller awaits
 *    before a programmatic `navigate()`.
 *
 * The click listener exists because `useBlocker` is unavailable here: it
 * requires a data router, and the app mounts a plain `<BrowserRouter>`
 * (App.tsx). Calling it throws "useBlocker must be used within a data router"
 * and takes the whole page down.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string) {
  // Read through a ref so the listeners can stay installed across renders
  // instead of being torn down and rebuilt on every keystroke.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const messageRef = useRef(message);
  messageRef.current = message;

  const confirmLeave = useCallback(() => {
    if (!dirtyRef.current) return true;
    return window.confirm(messageRef.current);
  }, []);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }

    function handleClick(e: MouseEvent) {
      if (!dirtyRef.current || e.defaultPrevented) return;
      // Modified clicks open a new tab, which leaves this one alone.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      if (!window.confirm(messageRef.current)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    // Capture phase, so the decision happens before React Router's own handler
    // starts the navigation.
    document.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return confirmLeave;
}
