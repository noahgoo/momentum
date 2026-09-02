import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Goal, GoalLog } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { getLast7Dates } from "../lib/goalHistory";
import { qk } from "./keys";

export interface ClientGoalsData {
  /** All goals (active + archived) — the panel filters locally for the active list / archived list. */
  goals: Goal[];
  /** goal_logs for the last 7 days, for the weekly bar chart + day drill-down. */
  weekLogs: GoalLog[];
}

/** Goals + last-7-days goal_logs for one client, used by the coach client-detail Goals panel. */
export function useClientGoals(clientId: string | undefined) {
  return useQuery<ClientGoalsData>({
    queryKey: qk.clientGoals(clientId ?? ""),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const id = clientId as string;
      const last7 = getLast7Dates();

      const [goalsRes, logsRes] = await Promise.all([
        supabase.from("goals").select("*").eq("client_id", id).order("created_at", { ascending: true }),
        supabase
          .from("goal_logs")
          .select("*")
          .eq("client_id", id)
          .in("date", last7),
      ]);
      if (goalsRes.error) throw goalsRes.error;
      if (logsRes.error) throw logsRes.error;

      return { goals: goalsRes.data ?? [], weekLogs: logsRes.data ?? [] };
    },
  });
}

/** Coach-added goal: `set_by` = the coach's own id, `locked` defaults true (toggleable in the add form). */
export function useCreateClientGoal(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ text, setBy, locked }: { text: string; setBy: string; locked: boolean }) => {
      const { data, error } = await supabase
        .from("goals")
        .insert({ client_id: clientId, text, set_by: setBy, locked })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.clientGoals(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientDetail(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
    },
  });
}

/** Coach lock/unlock toggle — locked goals can't be edited/archived by the client (plan finding #6). */
export function useToggleGoalLock(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ goalId, locked }: { goalId: string; locked: boolean }) => {
      const { error } = await supabase.from("goals").update({ locked }).eq("id", goalId);
      if (error) throw error;
    },
    onMutate: async ({ goalId, locked }) => {
      const key = qk.clientGoals(clientId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ClientGoalsData>(key);
      queryClient.setQueryData<ClientGoalsData>(key, (current) =>
        current
          ? {
              ...current,
              goals: current.goals.map((g) => (g.id === goalId ? { ...g, locked } : g)),
            }
          : current
      );
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.clientGoals(clientId) });
    },
  });
}

/**
 * Soft-archives a goal (plan finding #6: NEVER delete). Sets `active: false`,
 * `archived_at: now()`, `archived_by` = the acting coach's id. `goal_logs`
 * rows are untouched so history stays intact after archiving.
 */
export function useArchiveClientGoal(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ goalId, archivedBy }: { goalId: string; archivedBy: string }) => {
      const { error } = await supabase
        .from("goals")
        .update({ active: false, archived_at: new Date().toISOString(), archived_by: archivedBy })
        .eq("id", goalId);
      if (error) throw error;
    },
    onMutate: async ({ goalId }) => {
      const key = qk.clientGoals(clientId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ClientGoalsData>(key);
      queryClient.setQueryData<ClientGoalsData>(key, (current) =>
        current
          ? {
              ...current,
              goals: current.goals.map((g) =>
                g.id === goalId ? { ...g, active: false, archived_at: new Date().toISOString() } : g
              ),
            }
          : current
      );
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.clientGoals(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientDetail(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
    },
  });
}
