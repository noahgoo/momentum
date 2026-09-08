import { useNavigate } from "react-router";
import { useDeleteProgram, useDuplicateProgram, usePrograms, ProgramInUseError } from "../queries/usePrograms";

/**
 * Lists the coach's programs: name, total weeks, phase count, and
 * edit/duplicate/delete actions. Each card's Assign button carries the
 * program into the assign flow, which has no sidebar entry of its own.
 */
export function ProgramsPage() {
  const navigate = useNavigate();
  const { data: programs = [], isLoading } = usePrograms();
  const deleteProgram = useDeleteProgram();
  const duplicateProgram = useDuplicateProgram();

  async function handleDelete(id: string, name: string) {
    const ok = window.confirm(`Delete "${name}"? This removes its phases and schedule too. This can't be undone.`);
    if (!ok) return;
    try {
      await deleteProgram.mutateAsync(id);
    } catch (error) {
      // A program still in use is a normal outcome, not a crash: say who
      // depends on it rather than letting a foreign-key error escape.
      window.alert(
        error instanceof ProgramInUseError
          ? `${error.message} Reassign them before deleting it.`
          : `Could not delete "${name}". Please try again.`
      );
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-[var(--ink-50)]">
          {isLoading ? "Loading…" : `${programs.length} program${programs.length === 1 ? "" : "s"}`}
        </p>
        <button
          type="button"
          onClick={() => navigate("/library/programs/new")}
          className="rounded-lg bg-[var(--blue-deep)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          New program
        </button>
      </div>

      {isLoading && <p className="text-sm text-[var(--ink-30)]">Loading…</p>}

      {!isLoading && programs.length === 0 && (
        <div className="admin-card p-8 text-center text-sm text-[var(--ink-30)]">
          No programs yet. Create your first one to get started.
        </div>
      )}

      {!isLoading && programs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((program) => (
            <div key={program.id} className="admin-card flex flex-col p-5">
              <h2 className="truncate font-display text-lg text-[var(--ink)]">{program.name}</h2>
              {program.description && (
                <p className="mt-1 line-clamp-2 text-sm text-[var(--ink-50)]">{program.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-50)]">
                <span>{program.weeks ?? 0} weeks</span>
                <span>·</span>
                <span>
                  {program.phaseCount > 0 ? `${program.phaseCount} phase${program.phaseCount === 1 ? "" : "s"}` : "Flat"}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-[var(--ink-08)] pt-4">
                <button
                  type="button"
                  onClick={() => navigate(`/library/programs/${program.id}`)}
                  className="flex-1 rounded-lg border border-[var(--ink-08)] px-3 py-1.5 text-xs font-medium text-[var(--ink-70)] hover:bg-[var(--paper)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/assign?program=${program.id}`)}
                  className="rounded-lg border border-[var(--ink-08)] px-3 py-1.5 text-xs font-medium text-[var(--ink-70)] hover:bg-[var(--paper)]"
                >
                  Assign
                </button>
                <button
                  type="button"
                  onClick={() => void duplicateProgram.mutateAsync(program.id)}
                  disabled={duplicateProgram.isPending}
                  className="rounded-lg border border-[var(--ink-08)] px-3 py-1.5 text-xs font-medium text-[var(--ink-70)] hover:bg-[var(--paper)] disabled:opacity-40"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(program.id, program.name)}
                  disabled={deleteProgram.isPending}
                  className="rounded-lg border border-[var(--ink-08)] px-3 py-1.5 text-xs font-medium text-[var(--bad)] hover:bg-red-50 disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
