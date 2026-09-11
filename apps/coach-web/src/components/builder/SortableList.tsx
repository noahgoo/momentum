import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

/**
 * Reusable drag-to-reorder list wrapper around dnd-kit, built for the
 * coach-web builder pages (workout exercises here in 9.3; program phases in
 * 9.4). Handles sensor setup, drag-end reordering, and per-row sortable
 * wiring so callers only supply items + a row renderer.
 *
 * ── Contract for consumers (e.g. the 9.4 program-phase list) ──────────────
 * - `items`: the ordered array to render. Order in this array IS display
 *   order — `SortableList` never reorders anything itself; it calls
 *   `onReorder(next)` with the already-reordered array and the caller is
 *   responsible for committing that to state (and, on save, to
 *   `sort_order`/equivalent persisted column).
 * - `getId(item)`: must return a stable, unique string per item for the
 *   lifetime of a drag. Do NOT derive this from array index — index changes
 *   on every reorder and will break drag identity mid-gesture. Use a
 *   database id when editing an existing row, or a stable client-generated
 *   id (e.g. `crypto.randomUUID()`) for a not-yet-saved row.
 * - `renderItem(item, index, dragHandleProps)`: renders one row. Spread
 *   `dragHandleProps` (`{ attributes, listeners, setActivatorNodeRef }`)
 *   onto whatever element should act as the drag handle (typically a small
 *   grip icon/button) — do NOT spread them onto the whole row, or clicks
 *   inside the row (buttons, inputs, the expand toggle) will fight the drag
 *   sensor's activation constraint.
 * - Each row's outer element is positioned/animated by `SortableList`
 *   itself (transform/transition/opacity via `useSortable`), so
 *   `renderItem` should return the row's *content* — SortableList supplies
 *   the wrapping `<div>` with the sortable ref and style already applied.
 * - Activation is per input type. `MouseSensor` carries a 5px move threshold
 *   (matching the old app), so plain clicks on buttons/inputs inside a row
 *   never start a drag. `TouchSensor` uses a 200ms press delay instead: a
 *   distance threshold on touch turns the first 5px of any swipe that began on
 *   the handle into a reorder, leaving no way to scroll the page from that
 *   spot. Long-press to drag, swipe to scroll.
 * - **Not `PointerSensor`.** It would make the touch sensor dead code:
 *   `pointerdown` precedes `touchstart`, and dnd-kit bails out of every other
 *   sensor once one has claimed the gesture (`activeRef.current !== null` in
 *   DndContext). Touch would silently keep the distance constraint. Mouse plus
 *   touch is dnd-kit's documented pairing for exactly this reason.
 * - Because the handle carries `touch-action: none`, keep it a reasonable
 *   finger target (~40px) so the press is easy to land.
 *
 * This component holds no domain knowledge (no exercises, no phases) — it
 * is intentionally generic so both 9.3 and 9.4 can import the same file.
 */

export interface SortableDragHandleProps {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
  isDragging: boolean;
}

export interface SortableListProps<T> {
  /** Ordered items to render — this array's order is authoritative display order. */
  items: T[];
  /** Stable unique id per item; must not be derived from array index. */
  getId: (item: T) => string;
  /** Called with the full reordered array after a drag completes. */
  onReorder: (next: T[]) => void;
  /** Renders one row's content; wrap the drag handle element with `dragHandleProps`. */
  renderItem: (item: T, index: number, dragHandleProps: SortableDragHandleProps) => ReactNode;
  /** Optional wrapper class applied to each row's positioned container. */
  rowClassName?: string;
  /** Optional class applied to the outer list container. */
  className?: string;
}

function SortableRow<T>({
  item,
  index,
  getId,
  renderItem,
  rowClassName,
}: {
  item: T;
  index: number;
  getId: (item: T) => string;
  renderItem: SortableListProps<T>["renderItem"];
  rowClassName?: string;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: getId(item) });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={rowClassName}>
      {renderItem(item, index, { attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}

export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  rowClassName,
  className,
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => getId(item) === active.id);
    const newIndex = items.findIndex((item) => getId(item) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item, index) => (
            <SortableRow
              key={getId(item)}
              item={item}
              index={index}
              getId={getId}
              renderItem={renderItem}
              rowClassName={rowClassName}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
