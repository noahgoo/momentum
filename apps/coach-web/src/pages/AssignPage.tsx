import { useSearchParams } from "react-router";
import { AssignForm } from "../components/assign/AssignForm";
import { useClientSummaries } from "../queries/useClientSummaries";
import { usePrograms } from "../queries/usePrograms";
import { useWorkouts } from "../queries/useWorkouts";

/**
 * Coach-web Assign slice (9.5): assign a library program directly to a
 * client, starting on a chosen date. No per-client program copies (that's a
 * later feature per NON-GOALS) — the assignment just references the
 * template program row.
 */
export function AssignPage() {
  const [searchParams] = useSearchParams();
  const initialClientId = searchParams.get("client") ?? "";
  const initialProgramId = searchParams.get("program") ?? "";

  const { data: clients, isLoading: clientsLoading } = useClientSummaries();
  const { data: programs, isLoading: programsLoading } = usePrograms();
  const { data: workouts, isLoading: workoutsLoading } = useWorkouts("workout");

  const activeClients = (clients ?? []).filter((c) => !c.disabled);

  if (clientsLoading || programsLoading || workoutsLoading) {
    return <p className="text-sm text-[var(--ink-30)]">Loading…</p>;
  }

  return (
    <div className="max-w-2xl pb-16">
      <h1 className="mb-6 font-display text-2xl text-[var(--ink)]">Assign program</h1>
      <AssignForm
        clients={activeClients}
        programs={programs ?? []}
        workouts={workouts ?? []}
        initialClientId={initialClientId}
        initialProgramId={initialProgramId}
      />
    </div>
  );
}
