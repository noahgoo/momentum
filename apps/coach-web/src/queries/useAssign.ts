import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseDateStr } from "@momentum/shared";
import type { Program } from "@momentum/shared";
import { describeRpcError } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/**
 * Coach-web Assign slice (9.5) queries/mutations. Reads/writes go straight
 * to `assignments` — the `client_summaries` trigger (plan finding #8) picks
 * up `has_program`/`today_workout_name` automatically, so nothing here
 * writes to `client_summaries` directly.
 */

// ---------------------------------------------------------------------------
// Current active assignment (for the "this will be replaced" card)
// ---------------------------------------------------------------------------

export interface ActiveAssignmentInfo {
  assignmentId: string;
  startDate: string; // YYYY-MM-DD
  program: Program;
  /** 1-based current week, clamped to the program's total weeks (or 1 if weeks is unset). Null before start_date. */
  currentWeek: number | null;
}

/**
 * The selected client's current active assignment, if any. No client-side
 * `coach_id` filter — RLS on `assignments`/`programs` already scopes reads
 * to `is_coach_of(client_id)` / `created_by = auth.uid()`.
 */
export function useClientActiveAssignment(clientId: string | undefined, todayStr: string) {
  return useQuery<ActiveAssignmentInfo | null>({
    queryKey: qk.clientActiveAssignment(clientId ?? "__none__", todayStr),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignments")
        .select("id, start_date, programs(*)")
        .eq("client_id", clientId as string)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (!data || !data.programs) return null;

      const program = data.programs as Program;
      const start = parseDateStr(data.start_date);
      // The CLIENT's today, not the coach's — see docs/rules/concurrency.md C1.
      const today = parseDateStr(todayStr);
      let currentWeek: number | null = null;
      if (start && today && today.getTime() >= start.getTime()) {
        const daysDiff = Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        const totalWeeks = program.weeks && program.weeks > 0 ? program.weeks : 1;
        currentWeek = Math.min(Math.floor(daysDiff / 7) + 1, totalWeeks);
      }

      return {
        assignmentId: data.id,
        startDate: data.start_date,
        program,
        currentWeek,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Assign mutation
// ---------------------------------------------------------------------------

export interface AssignProgramInput {
  clientId: string;
  programId: string;
  startDate: string; // YYYY-MM-DD
}

/** Domain wording for the codes assign_program raises. */
const ASSIGN_ERRORS = {
  not_your_client: "That client isn't one of yours.",
  program_not_found: "That program no longer exists.",
  not_a_template: "That program is already a client's copy — assign from your library instead.",
};

export function describeAssignError(error: unknown): string {
  return describeRpcError(error, ASSIGN_ERRORS);
}

/**
 * Assigns a program through the `assign_program` RPC, which DEEP-COPIES the
 * program tree into rows owned by this client before pointing the assignment
 * at the copy.
 *
 * Assignment used to link the coach's template row directly, so every client
 * on a program shared one set of rows: editing the template reshuffled the
 * live schedule of everyone already mid-program (B1, B2). The deactivate and
 * insert also ran as separate requests, leaving a window with no active
 * assignment and a 23505 retry to paper over it (B8). Both are now one
 * transaction server-side.
 */
export function useAssignProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AssignProgramInput) => {
      const { data, error } = await supabase.rpc("assign_program", {
        p_client_id: input.clientId,
        p_program_id: input.programId,
        p_start_date: input.startDate,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: (_assignmentId, input) => {
      void queryClient.invalidateQueries({ queryKey: qk.clientDetail(input.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientActiveAssignment(input.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
    },
  });
}
