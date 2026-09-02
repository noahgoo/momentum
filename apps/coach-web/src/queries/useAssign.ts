import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dateStr, parseDateStr } from "@momentum/shared";
import type { Program } from "@momentum/shared";
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
export function useClientActiveAssignment(clientId: string | undefined) {
  return useQuery<ActiveAssignmentInfo | null>({
    queryKey: qk.clientActiveAssignment(clientId ?? "__none__"),
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
      const today = parseDateStr(dateStr(new Date()));
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

const UNIQUE_VIOLATION = "23505";

export interface AssignProgramInput {
  clientId: string;
  programId: string;
  startDate: string; // YYYY-MM-DD
}

/**
 * Deactivates the client's existing active assignment (if any), then inserts
 * a new active one. The partial unique index `assignments_one_active_per_client`
 * (WHERE active) means a second coach session — or a double-click — racing
 * this same client can hit a 23505 on the insert even after our own
 * deactivate succeeded. We retry the whole deactivate-then-insert sequence
 * once; a second failure surfaces as a real error rather than looping.
 */
async function deactivateThenInsert(input: AssignProgramInput) {
  const { error: deactivateError } = await supabase
    .from("assignments")
    .update({ active: false })
    .eq("client_id", input.clientId)
    .eq("active", true);
  if (deactivateError) throw deactivateError;

  const { data, error: insertError } = await supabase
    .from("assignments")
    .insert({
      client_id: input.clientId,
      program_id: input.programId,
      start_date: input.startDate,
      active: true,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return data.id as string;
}

export function useAssignProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AssignProgramInput) => {
      try {
        return await deactivateThenInsert(input);
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code !== UNIQUE_VIOLATION) throw err;
        // Retry once: another active row may have been (re)created between
        // our deactivate and insert (e.g. a concurrent assign for the same
        // client). One retry re-runs deactivate-then-insert from scratch.
        return await deactivateThenInsert(input);
      }
    },
    onSuccess: (_assignmentId, input) => {
      void queryClient.invalidateQueries({ queryKey: qk.clientDetail(input.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientActiveAssignment(input.clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
    },
  });
}
