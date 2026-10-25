import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DayOfWeek } from "@momentum/shared";
import { describeRpcError } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/**
 * One client's copy of a program, shaped for the client program editor.
 *
 * Unlike useProgramDetail, a day here is identified by its SESSION id, not by
 * the library workout it came from: a client's day may have been edited,
 * built blank, or migrated with no library source at all, and every one of
 * them is still a day the coach can move, replace or remove.
 */
export interface ClientProgramDay {
  sessionId: string;
  /** Null in a flat program. */
  phaseId: string | null;
  /** Phase-local in a phased program, global in a flat one (as stored). */
  week: number;
  day: DayOfWeek;
  name: string;
}

export interface ClientProgramPhase {
  id: string;
  name: string;
  weeks: number;
}

export interface ClientProgram {
  id: string;
  name: string;
  description: string | null;
  clientId: string;
  weeks: number;
  phased: boolean;
  phases: ClientProgramPhase[];
  days: ClientProgramDay[];
  /** yyyy-mm-dd the client's assignment starts; null if never assigned. */
  startDate: string | null;
  updatedAt: string;
}

export function useClientProgram(programId: string | undefined) {
  return useQuery<ClientProgram | null>({
    // Nested under the program's key so every invalidation of programDetail
    // (and of qk.programs()) reaches it too.
    queryKey: qk.clientProgram(programId ?? "__none__"),
    queryFn: async () => {
      if (!programId) return null;

      const { data: program, error: programError } = await supabase
        .from("programs")
        .select("*")
        .eq("id", programId)
        .single();
      if (programError) throw programError;
      if (!program.client_id) return null;

      const { data: phases, error: phasesError } = await supabase
        .from("program_phases")
        .select("id, name, weeks, sort_order")
        .eq("program_id", programId)
        .order("sort_order", { ascending: true });
      if (phasesError) throw phasesError;

      const phaseIds = (phases ?? []).map((p) => p.id);
      const sessionsQuery = supabase
        .from("sessions")
        .select("id, phase_id, program_id, week_number, day_of_week, name");
      const { data: sessions, error: sessionsError } =
        phaseIds.length > 0
          ? await sessionsQuery.or(`program_id.eq.${programId},phase_id.in.(${phaseIds.join(",")})`)
          : await sessionsQuery.eq("program_id", programId);
      if (sessionsError) throw sessionsError;

      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("start_date")
        .eq("program_id", programId)
        .order("active", { ascending: false })
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (assignmentError) throw assignmentError;

      return {
        id: program.id,
        name: program.name,
        description: program.description,
        clientId: program.client_id,
        weeks: program.weeks ?? 1,
        phased: phaseIds.length > 0,
        phases: (phases ?? []).map((p) => ({ id: p.id, name: p.name ?? "", weeks: p.weeks ?? 1 })),
        days: (sessions ?? []).map((s) => ({
          sessionId: s.id,
          phaseId: s.phase_id,
          week: s.week_number,
          day: s.day_of_week,
          name: s.name,
        })),
        startDate: assignment?.start_date ?? null,
        updatedAt: program.updated_at,
      };
    },
    enabled: !!programId,
  });
}

/** A day as the editor holds it: kept, copied from a workout, or blank. */
export type EditorDayContent =
  | { kind: "session"; sessionId: string; name: string }
  | { kind: "workout"; workoutId: string; name: string }
  | { kind: "blank"; name: string };

export interface SaveClientProgramInput {
  programId: string;
  name: string;
  description: string;
  phased: boolean;
  /** In display order. `id` is null for a phase added in this edit. */
  phases: { id: string | null; name: string; weeks: number }[];
  flatWeeks: number;
  days: { phaseIndex: number | null; week: number; day: DayOfWeek; content: EditorDayContent }[];
  expectedUpdatedAt: string | null;
}

const SAVE_CLIENT_PROGRAM_ERRORS = {
  stale_write:
    "This program changed while you were editing it. Reload to see the current version before saving.",
  not_a_client_program: "This is a library template, not a client's program.",
  duplicate_slot: "Two workouts are on the same day. Move or remove one, then save.",
  invalid_payload: "Something in this program is out of range — check each phase has at least one week.",
};

export function describeSaveClientProgramError(error: unknown): string {
  return describeRpcError(error, SAVE_CLIENT_PROGRAM_ERRORS);
}

export function useSaveClientProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveClientProgramInput) => {
      const { error } = await supabase.rpc("save_client_program", {
        p_program_id: input.programId,
        p_expected_updated_at: input.expectedUpdatedAt ?? undefined,
        p_payload: {
          name: input.name,
          description: input.description || null,
          phased: input.phased,
          weeks: input.flatWeeks,
          phases: input.phases.map((p) => ({ id: p.id, name: p.name || null, weeks: p.weeks })),
          slots: input.days.map(({ phaseIndex, week, day, content }) => ({
            ...(phaseIndex === null ? {} : { phase_index: phaseIndex }),
            week_number: week,
            day_of_week: day,
            ...(content.kind === "session"
              ? { session_id: content.sessionId }
              : content.kind === "workout"
                ? { workout_id: content.workoutId }
                : { name: content.name }),
          })),
        },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      // The coach's program and day views, and the client's schedule as the
      // coach sees it, all read these rows (R6). Schedule tables are not in the
      // realtime publication, so the client's app picks a change up on its next
      // fetch of the day — the same as a save_session edit.
      void queryClient.invalidateQueries({ queryKey: qk.programs() });
      void queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
    },
  });
}
