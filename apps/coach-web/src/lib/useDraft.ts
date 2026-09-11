import { useCallback, useEffect, useRef, useState } from "react";
import { shouldRestoreDraft } from "@momentum/shared";

/**
 * Local persistence for in-progress coach entry — the browser counterpart of
 * apps/mobile/lib/useDraft.ts, same contract over `localStorage`.
 *
 * The builders held an entire unsaved program in component state, so a reload,
 * a mis-click on a nav link, or a crashed tab destroyed it (violation S-1).
 *
 * Two differences from the mobile hook, both because `localStorage` is
 * synchronous:
 *  - hydration happens in a `useState` initializer, so `hydrated` is true on
 *    the first render and there is no flash of empty form to guard against;
 *  - writes are still debounced, because serializing a large program tree on
 *    every keystroke is wasted work even when it cannot block.
 *
 * Every access is wrapped: Safari's private mode throws on `localStorage`, and
 * a full quota throws on write. Losing persistence must never break the
 * builder — the in-memory state is intact and the server save is the real
 * durability path.
 *
 * See docs/rules/offline-perf.md S1.
 */

const WRITE_DEBOUNCE_MS = 500;

interface StoredDraft<T> {
  savedAt: number;
  drafts: T;
}

export interface DraftState<T> {
  /** Always true here — kept so both apps' callers read the same shape. */
  hydrated: boolean;
  /** The restored draft, if one was found and is newer than the server's copy. */
  restored: T | null;
  /** Whether a draft was actually restored, so the UI can say so. */
  didRestore: boolean;
  /** Persist the current draft (debounced). */
  save: (draft: T) => void;
  /** Drop the stored draft — after a confirmed server save, or an explicit discard. */
  clear: () => void;
}

/**
 * Pure: this runs during render, so it must not touch storage beyond reading.
 * A draft found to be stale is pruned by an effect below instead.
 */
function read<T>(
  key: string | null,
  serverUpdatedAt: string | null | undefined
): { value: T | null; stale: boolean } {
  if (!key) return { value: null, stale: false };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { value: null, stale: false };
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (shouldRestoreDraft(parsed.savedAt, serverUpdatedAt)) {
      return { value: parsed.drafts, stale: false };
    }
    return { value: null, stale: true };
  } catch {
    // Corrupt, or storage unavailable. Fall through to the server's copy, and
    // treat an unreadable entry as stale so it stops taking up space.
    return { value: null, stale: true };
  }
}

/**
 * @param key A stable id for what this draft belongs to, already namespaced by
 *            coach (see `draftKey`). Null disables persistence — used while the
 *            coach id or the route param is still loading.
 * @param serverUpdatedAt When the server's copy was last written; null when
 *            there is no server copy yet, in which case any draft restores.
 */
export function useDraft<T>(key: string | null, serverUpdatedAt?: string | null): DraftState<T> {
  // Read once per key, during render. Re-reading on every server refetch would
  // re-restore a draft the coach has already moved past.
  const [initial, setInitial] = useState(() => ({ key, ...read<T>(key, serverUpdatedAt) }));
  if (initial.key !== key) {
    setInitial({ key, ...read<T>(key, serverUpdatedAt) });
  }

  // Drop a superseded draft, out of the render path.
  const stale = initial.stale;
  useEffect(() => {
    if (!key || !stale) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing further to try.
    }
  }, [key, stale]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);

  const flush = useCallback(() => {
    if (!key || pending.current === null) return;
    const payload: StoredDraft<T> = { savedAt: Date.now(), drafts: pending.current };
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Quota exceeded or storage blocked.
    }
  }, [key]);

  const save = useCallback(
    (draft: T) => {
      pending.current = draft;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
    },
    [flush]
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to do — a draft we cannot delete is still superseded by the
      // server copy's newer timestamp on the next read.
    }
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

  return {
    hydrated: true,
    restored: initial.value,
    didRestore: initial.value !== null,
    save,
    clear,
  };
}

/**
 * Namespaced draft key. The coach id comes first because a shared browser must
 * never offer one coach's unsaved program to another; `kind` separates the
 * workout and warmup builders, which are the same component behind different
 * routes.
 */
export function draftKey(
  coachId: string | undefined,
  kind: string,
  id: string | undefined
): string | null {
  if (!coachId) return null;
  return `momentum.draft:${coachId}:${kind}:${id ?? "new"}`;
}
