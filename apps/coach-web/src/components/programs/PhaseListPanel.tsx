import { SortableList, type SortableDragHandleProps } from "../builder/SortableList";
import type { BuilderPhase } from "../../queries/usePrograms";

export interface PhaseListPanelProps {
  phases: BuilderPhase[];
  selectedId: string | null;
  onReorder: (next: BuilderPhase[]) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

function PhaseRow({
  phase,
  isSelected,
  onSelect,
  onRemove,
  dragHandleProps,
}: {
  phase: BuilderPhase;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
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
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={`-my-2 flex h-10 w-8 shrink-0 items-center justify-center text-xs transition-colors lg:my-0 lg:h-auto lg:w-auto ${
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
export function PhaseListPanel({ phases, selectedId, onReorder, onSelect, onAdd, onRemove }: PhaseListPanelProps) {
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
