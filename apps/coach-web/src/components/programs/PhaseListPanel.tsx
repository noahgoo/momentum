import { SortableList, type SortableDragHandleProps } from "../builder/SortableList";

/** The least a row needs: the library builder's and the client editor's phases both fit. */
export interface PhaseListItem {
  id: string;
  name: string;
}

export interface PhaseListPanelProps<T extends PhaseListItem> {
  phases: T[];
  selectedId: string | null;
  onReorder: (next: T[]) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  /** False greys out every remove button, e.g. when only one phase is left. */
  canRemove?: boolean;
}

function PhaseRow({
  phase,
  isSelected,
  onSelect,
  onRemove,
  canRemove,
  dragHandleProps,
}: {
  phase: PhaseListItem;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  canRemove: boolean;
  dragHandleProps: SortableDragHandleProps;
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 transition-colors ${
        isSelected
          ? "bg-[var(--blue-deep)] text-white shadow-sm"
          : "border border-[var(--ink-08)] bg-white text-[var(--ink-70)] hover:border-[var(--blue)]"
      }`}
    >
      <button
        type="button"
        {...dragHandleProps.attributes}
        {...dragHandleProps.listeners}
        ref={dragHandleProps.setActivatorNodeRef}
        onClick={(e) => e.stopPropagation()}
        className={`-my-2 flex h-10 w-8 shrink-0 items-center justify-center cursor-grab text-sm active:cursor-grabbing lg:my-0 lg:h-auto lg:w-auto ${
          isSelected ? "text-white/60" : "text-[var(--ink-30)]"
        }`}
        aria-label="Drag to reorder"
      >
        ⠿
      </button>
      <span className="flex-1 truncate text-sm font-medium">{phase.name || "Unnamed phase"}</span>
      <button
        type="button"
        disabled={!canRemove}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={`-my-2 flex h-10 w-8 shrink-0 items-center justify-center text-xs transition-colors disabled:opacity-30 lg:my-0 lg:h-auto lg:w-auto ${
          isSelected ? "text-white/70 hover:text-white" : "text-[var(--ink-30)] hover:text-[var(--bad)]"
        }`}
        aria-label="Remove phase"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * LEFT panel of the phased builder: sortable phase list (drag reorders
 * `sort_order` on save), select-to-edit, add/remove. Reuses `SortableList`
 * per its JSDoc contract — see that file for the drag-handle-props wiring
 * rule (spread onto the handle only, never the whole row).
 */
export function PhaseListPanel<T extends PhaseListItem>({
  phases,
  selectedId,
  onReorder,
  onSelect,
  onAdd,
  onRemove,
  canRemove = true,
}: PhaseListPanelProps<T>) {
  return (
    <div className="space-y-3">
      {phases.length === 0 ? (
        <p className="text-xs italic text-[var(--ink-30)]">No phases yet.</p>
      ) : (
        <SortableList
          items={phases}
          getId={(phase) => phase.id}
          onReorder={onReorder}
          className="space-y-2"
          renderItem={(phase, _index, dragHandleProps) => (
            <PhaseRow
              phase={phase}
              isSelected={phase.id === selectedId}
              onSelect={() => onSelect(phase.id)}
              onRemove={() => onRemove(phase.id)}
              canRemove={canRemove}
              dragHandleProps={dragHandleProps}
            />
          )}
        />
      )}
      <button
        type="button"
        onClick={onAdd}
        className="w-full rounded-lg border border-dashed border-[var(--ink-08)] px-3 py-2 text-xs font-medium text-[var(--ink-50)] hover:border-[var(--blue-deep)] hover:text-[var(--blue-deep)]"
      >
        + Add phase
      </button>
    </div>
  );
}
