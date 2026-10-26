import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { EditorDayContent } from "../../queries/useClientProgram";

interface PickableWorkout {
  id: string;
  name: string;
}

/** What a row currently holds, in the terms the row needs. */
export interface ClientDayEntry {
  name: string;
  /** "session" is saved; "workout" and "blank" are new this edit and unsaved. */
  kind: EditorDayContent["kind"];
}

const CURRENT = "__current__";
const BLANK = "__blank__";

const selectClass =
  "min-w-0 flex-1 rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--blue-deep)]";

/**
 * One scheduled day of a client's program: a dropdown, an Edit link and an
 * actions menu.
 *
 * The dropdown is shaped like the library builder's, but its value is this
 * day's own copy, never a library id (R9). The day's name is therefore a
 * synthetic option of its own, so a day with no library source (migrated, or
 * built blank) still shows what it is rather than reading as Rest. Choosing
 * something else REPLACES the day, which discards the day's edits, so a saved
 * day asks first.
 */
export function ClientDayRow({
  testId,
  label,
  entry,
  library,
  shelf,
  editHref,
  onEditUnsaved,
  saving,
  onChoose,
  onRest,
  onMove,
  onSaveAsWorkout,
  below,
}: {
  testId: string;
  /** e.g. "Tue · Aug 25". */
  label: string;
  entry: ClientDayEntry | null;
  library: PickableWorkout[];
  shelf: PickableWorkout[];
  /** Where the day's editor lives; null while the day is unsaved. */
  editHref: string | null;
  /**
   * For a day that exists only in this edit: saves the program, then opens the
   * day. Null when it can't (nothing to open yet, or the program won't save).
   */
  onEditUnsaved: (() => void) | null;
  /** A save is in flight; the day can't be opened or replaced meanwhile. */
  saving: boolean;
  onChoose: (content: EditorDayContent) => void;
  onRest: () => void;
  onMove: () => void;
  /** Null when the day isn't saved yet, so there is nothing to file away. */
  onSaveAsWorkout: (() => void) | null;
  /** The move form, when open. */
  below?: ReactNode;
}) {
  const [blankOpen, setBlankOpen] = useState(false);
  const [blankName, setBlankName] = useState("");
  const byId = new Map([...library, ...shelf].map((w) => [w.id, w]));
  const saved = entry?.kind === "session";

  // A Move or Remove from the menu changes what this form would replace.
  const entryIdentity = entry ? `${entry.kind}:${entry.name}` : "";
  useEffect(() => {
    setBlankOpen(false);
    setBlankName("");
  }, [entryIdentity]);

  function confirmReplace(): boolean {
    if (!saved) return true;
    return window.confirm(
      `Replace "${entry!.name}"? This swaps in a fresh copy — the day's current exercises and edits are discarded when you save.`
    );
  }

  /** Remove from the menu: same loss as choosing Rest, so the same question. */
  function confirmRemove(): boolean {
    if (!saved) return true;
    return window.confirm(
      `Remove "${entry!.name}"? The day's exercises and edits are discarded when you save. Past logs are kept.`
    );
  }

  function handleChange(value: string) {
    if (value === CURRENT) return;
    if (value === "") {
      if (entry && confirmReplace()) onRest();
      return;
    }
    if (value === BLANK) {
      setBlankOpen(true);
      return;
    }
    const w = byId.get(value);
    if (w && confirmReplace()) onChoose({ kind: "workout", workoutId: w.id, name: w.name });
  }

  function submitBlank() {
    const name = blankName.trim();
    if (!name || !confirmReplace()) return;
    onChoose({ kind: "blank", name });
    setBlankOpen(false);
    setBlankName("");
  }

  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-xs text-[var(--ink-30)]">{label}</span>
        <select
          aria-label={`Workout for ${label}`}
          disabled={saving}
          value={entry ? CURRENT : ""}
          onChange={(e) => handleChange(e.target.value)}
          className={selectClass}
        >
          <option value="">— Rest day —</option>
          {entry && <option value={CURRENT}>{entry.name}</option>}
          <option value={BLANK}>Blank day…</option>
          {shelf.length > 0 && (
            <optgroup label="This client's workouts">
              {shelf.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Library">
            {library.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </optgroup>
        </select>
        {entry && (
          <div className="flex shrink-0 items-center gap-2">
            {entry.kind !== "session" && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                unsaved
              </span>
            )}
            {editHref ? (
              <Link
                to={editHref}
                className="text-xs font-medium text-[var(--ink-50)] underline hover:text-[var(--ink)]"
              >
                Edit
              </Link>
            ) : (
              onEditUnsaved && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={onEditUnsaved}
                  title="Saves the program first, then opens this day"
                  className="text-xs font-medium text-[var(--ink-50)] underline hover:text-[var(--ink)] disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Edit"}
                </button>
              )
            )}
            <DayMenu
              onMove={onMove}
              onSaveAsWorkout={onSaveAsWorkout}
              onRemove={() => {
                if (confirmRemove()) onRest();
              }}
            />
          </div>
        )}
      </div>

      {blankOpen && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-lg bg-white p-3">
          <input
            aria-label="Day name"
            value={blankName}
            onChange={(e) => setBlankName(e.target.value)}
            placeholder="e.g. Mobility"
            className="min-w-0 flex-1 basis-40 rounded-lg border border-[var(--ink-08)] bg-white px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={!blankName.trim()}
            onClick={submitBlank}
            className="admin-primary px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {entry ? "Replace" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setBlankOpen(false);
              setBlankName("");
            }}
            className="admin-secondary px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
        </div>
      )}
      {below}
    </div>
  );
}

/** The ⋯ overflow menu: the actions that don't earn a permanent spot on the row. */
function DayMenu({
  onMove,
  onSaveAsWorkout,
  onRemove,
}: {
  onMove: () => void;
  onSaveAsWorkout: (() => void) | null;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
      } else if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const item = "block w-full px-3 py-2 text-left text-xs font-medium hover:bg-[var(--paper)]";
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Day actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-base leading-none text-[var(--ink-50)] hover:bg-white hover:text-[var(--ink)]"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-[var(--ink-08)] bg-white py-1 shadow-lg"
        >
          <button type="button" role="menuitem" onClick={run(onMove)} className={`${item} text-[var(--ink-70)]`}>
            Move
          </button>
          {onSaveAsWorkout && (
            <button
              type="button"
              role="menuitem"
              onClick={run(onSaveAsWorkout)}
              className={`${item} text-[var(--ink-70)]`}
            >
              Save as workout
            </button>
          )}
          <button type="button" role="menuitem" onClick={run(onRemove)} className={`${item} text-[var(--bad)]`}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
