import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { ClientSummary, Workout } from "@momentum/shared";
import type { ProgramListRow } from "../../queries/usePrograms";
import { useProgramDetail } from "../../queries/usePrograms";
import { useClientDate } from "../../lib/useClientDate";
import { useAssignProgram, useClientActiveAssignment } from "../../queries/useAssign";
import { CurrentAssignmentCard } from "./CurrentAssignmentCard";
import { SchedulePreview, toProgramPreview } from "./SchedulePreview";

const selectClass =
  "w-full rounded-lg border border-[var(--ink-08)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]";

interface Props {
  clients: ClientSummary[];
  programs: ProgramListRow[];
  workouts: Workout[];
  initialClientId: string;
  initialProgramId: string;
}

export function AssignForm({ clients, programs, workouts, initialClientId, initialProgramId }: Props) {
  const navigate = useNavigate();

  const [clientId, setClientId] = useState(initialClientId);
  const [programId, setProgramId] = useState(initialProgramId);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [successAssignmentId, setSuccessAssignmentId] = useState<string | null>(null);

  const { data: programDetail } = useProgramDetail(programId || undefined);
  // The CLIENT's today, not the coach's — a coach in NY assigning to an LA
  // client must not default the start date to the client's tomorrow.
  const { today: clientToday } = useClientDate(clientId || undefined);
  // Null until the coach picks a date: fall back to the selected client's
  // today, so switching clients re-defaults rather than keeping a stale date.
  const effectiveStartDate = startDate ?? clientToday;
  const { data: activeAssignment } = useClientActiveAssignment(clientId || undefined, clientToday);
  const assignProgram = useAssignProgram();

  // Re-preselect from URL params if they change after mount (e.g. nav from a
  // different client's header card while this page is already mounted).
  useEffect(() => {
    if (initialClientId) setClientId(initialClientId);
  }, [initialClientId]);
  useEffect(() => {
    if (initialProgramId) setProgramId(initialProgramId);
  }, [initialProgramId]);

  const selectedClient = clients.find((c) => c.client_id === clientId) ?? null;
  const selectedProgram = programs.find((p) => p.id === programId) ?? null;

  const workoutNameById = useMemo(() => new Map(workouts.map((w) => [w.id, w.name])), [workouts]);

  const programPreview = programDetail ? toProgramPreview(programDetail) : null;

  const validationErrors: string[] = [];
  if (!clientId) validationErrors.push("Choose a client.");
  if (!programId) validationErrors.push("Choose a program.");
  if (!effectiveStartDate) validationErrors.push("Choose a start date.");

  const canSubmit = validationErrors.length === 0 && !assignProgram.isPending;

  async function handleSubmit() {
    setSubmitted(true);
    setConflictError(null);
    setSuccessAssignmentId(null);
    if (validationErrors.length > 0) return;

    try {
      const assignmentId = await assignProgram.mutateAsync({ clientId, programId, startDate: effectiveStartDate });
      setSuccessAssignmentId(assignmentId);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "23505") {
        setConflictError(
          "Another active assignment was created for this client at the same time. Please try again."
        );
      } else {
        setConflictError(err instanceof Error ? err.message : "Failed to assign program.");
      }
    }
  }

  if (successAssignmentId) {
    return (
      <div className="admin-card space-y-3 p-6">
        <p className="text-sm font-medium text-[var(--ok)]">
          {selectedClient?.display_name || "Client"} is now assigned to {selectedProgram?.name || "the program"}.
        </p>
        <button
          type="button"
          onClick={() => navigate(`/clients/${clientId}`)}
          className="rounded-lg bg-[var(--blue-deep)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          View client
        </button>
        <button
          type="button"
          onClick={() => setSuccessAssignmentId(null)}
          className="ml-3 text-sm font-medium text-[var(--ink-50)] hover:text-[var(--ink)]"
        >
          Assign another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CurrentAssignmentCard assignment={activeAssignment ?? null} />

      <div className="admin-card space-y-4 p-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Client</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className={`${selectClass} ${submitted && !clientId ? "border-[var(--bad)]" : ""}`}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.client_id} value={c.client_id}>
                {c.display_name || c.email || c.client_id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Program</label>
          <select
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            className={`${selectClass} ${submitted && !programId ? "border-[var(--bad)]" : ""}`}
          >
            <option value="">Select a program…</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.weeks ? `(${p.weeks} week${p.weeks === 1 ? "" : "s"})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--ink-70)]">Start date</label>
          <input
            type="date"
            value={effectiveStartDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={`${selectClass} ${submitted && !effectiveStartDate ? "border-[var(--bad)]" : ""}`}
          />
          <p className="mt-1 text-xs text-[var(--ink-30)]">Any day of the week is allowed as a start date.</p>
        </div>

        <div className="border-t border-[var(--ink-08)] pt-4">
          <SchedulePreview
            clientName={selectedClient?.display_name ?? ""}
            programName={selectedProgram?.name ?? ""}
            programWeeks={selectedProgram?.weeks ?? null}
            program={programPreview}
            startDate={effectiveStartDate}
            workoutNameById={workoutNameById}
          />
        </div>

        {submitted && validationErrors.length > 0 && (
          <p className="text-xs font-medium text-[var(--bad)]">{validationErrors[0]}</p>
        )}
        {conflictError && <p className="text-xs font-medium text-[var(--bad)]">{conflictError}</p>}

        <div className="flex justify-end border-t border-[var(--ink-08)] pt-4">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="rounded-lg bg-[var(--blue-deep)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {assignProgram.isPending ? "Assigning…" : "Assign program"}
          </button>
        </div>
      </div>
    </div>
  );
}
