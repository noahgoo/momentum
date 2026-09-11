import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { shouldRestoreDraft } from "@momentum/shared";

/**
 * Local persistence for in-progress entry.
 *
 * The logger's drafts used to be plain component state, so navigating away,
 * the OS reclaiming the app, or a crash destroyed every set entered since the
 * last manual save — the client's own work, unrecoverable (violation S-1).
 *
 * Writes are debounced and fire-and-forget: entry must never block on
 * storage. Reads happen once on mount. A draft is cleared only after the
 * server confirms a save, so nothing is dropped on the strength of a write
 * we did not see land.
 *
 * Generic over both the draft shape and what it belongs to — callers build
 * their own key (see `useWorkoutDraft` below, and `measurementDraftKey`).
 *
 * See docs/rules/offline-perf.md S1.
 */

const WRITE_DEBOUNCE_MS = 500;

interface StoredDraft<T> {
  savedAt: number;
  drafts: T;
}

export interface DraftState<T> {
  /** False until the stored draft has been read — render nothing dependent on it before then. */
  hydrated: boolean;
  /** The restored draft, if one was found and is newer than the server's copy. */
  restored: T | null;
  /** Whether a draft was actually restored, so the UI can say so. */
  didRestore: boolean;
  /** Persist the current drafts (debounced). */
  save: (drafts: T) => void;
  /** Drop the stored draft — call only after a confirmed server save, or on an explicit discard. */
  clear: () => void;
}

/**
 * @param key   What this draft belongs to. Null disables persistence entirely
 *              (ids not loaded yet), and `hydrated` still resolves to true so
 *              the screen renders.
 * @param serverUpdatedAt When the server's copy was last written. A stored
 *              draft older than this has already been superseded (e.g. saved
 *              from another device) and is discarded rather than resurrecting
 *              stale values over fresher ones. Null when there is no server
 *              copy, in which case any draft is worth restoring.
 */
export function useDraft<T>(key: string | null, serverUpdatedAt?: string | null): DraftState<T> {
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState<T | null>(null);
  const [didRestore, setDidRestore] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);

  // Hydrate once per key.
  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setHydrated(true);
      return;
    }

    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as StoredDraft<T>;
          if (shouldRestoreDraft(parsed.savedAt, serverUpdatedAt)) {
            setRestored(parsed.drafts);
            setDidRestore(true);
          } else {
            void AsyncStorage.removeItem(key);
          }
        }
      } catch {
        // A corrupt or unreadable draft must never block the screen from
        // opening — fall through to the server's copy.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // serverUpdatedAt intentionally excluded from deps: re-running on every
    // server refetch would re-restore a draft the client has already moved past.
  }, [key]);

  const flush = useCallback(() => {
    if (!key || pending.current === null) return;
    const payload: StoredDraft<T> = { savedAt: Date.now(), drafts: pending.current };
    void AsyncStorage.setItem(key, JSON.stringify(payload)).catch(() => {
      // Storage full or unavailable: the in-memory drafts are still intact
      // and the server save is the real durability path.
    });
  }, [key]);

  const save = useCallback(
    (drafts: T) => {
      pending.current = drafts;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
    },
    [flush]
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    if (key) void AsyncStorage.removeItem(key).catch(() => {});
  }, [key]);

  // Flush on unmount rather than losing whatever the debounce was holding —
  // navigating away is exactly when the pending write matters most.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        flush();
      }
    };
  }, [flush]);

  return { hydrated, restored, didRestore, save, clear };
}

/** Key for one client's in-progress measurement entry on a given date. */
export function measurementDraftKey(clientId: string, date: string): string {
  return `measurementDraft:${clientId}:${date}`;
}
