import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExerciseMode, SessionSection, SetConfig } from "@momentum/shared";
import { describeRpcError, parseSetConfigs, serializeSetConfigs } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

export interface SessionDetailExercise {
  id: string;
  section: SessionSection;
  exerciseId: string | null;
  mode: ExerciseMode;
  setConfigs: SetConfig[];
  restSeconds: number | null;
  notes: string | null;
}

export interface SessionDetail {
  id: string;
  name: string;
  description: string | null;
  estimatedDurationMinutes: number | null;
  warmupName: string | null;
  /** Which library workout this day was built from. Null when built freehand. */
  sourceWorkoutId: string | null;
  /** The client this day belongs to, or null for a template program's day. */
  clientId: string | null;
  programId: string;
  /** Carried into the next save so a concurrent edit is detected (C3). */
  updatedAt: string;
  exercises: SessionDetailExercise[]; // ordered by section, then sort_order
}

/**
 * One scheduled day, for the session editor.
 *
 * Everything rendered here belongs to the session itself — the library
 * workout it came from is provenance, never read for display (R8/R9), so a
 * coach renaming that entry does not rename a client's already-scheduled day.
 */
export function useSessionDetail(sessionId: string | undefined) {
  return useQuery<SessionDetail | null>({
    queryKey: sessionId ? qk.sessionDetail(sessionId) : qk.sessionDetail("__none__"),
    enabled: Boolean(sessionId),
    queryFn: async () => {
      if (!sessionId) return null;

      const { data: session, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      if (error) throw error;

      const programId = session.program_id;
      let resolvedProgramId = programId;
      if (!resolvedProgramId && session.phase_id) {
        const { data: phase, error: phaseError } = await supabase
          .from("program_phases")
          .select("program_id")
          .eq("id", session.phase_id)
          .single();
        if (phaseError) throw phaseError;
        resolvedProgramId = phase.program_id;
      }

      const { data: program, error: programError } = await supabase
        .from("programs")
        .select("id, client_id")
        .eq("id", resolvedProgramId as string)
        .single();
      if (programError) throw programError;

      const { data: rows, error: rowsError } = await supabase
        .from("session_exercises")
        .select("*")
        .eq("session_id", sessionId)
        .order("section", { ascending: true })
        .order("sort_order", { ascending: true });
      if (rowsError) throw rowsError;

      return {
        id: session.id,
        name: session.name,
        description: session.description,
        estimatedDurationMinutes: session.estimated_duration_minutes,
        warmupName: session.warmup_name,
        sourceWorkoutId: session.source_workout_id,
        clientId: program.client_id,
        programId: program.id,
        updatedAt: session.updated_at,
        exercises: (rows ?? []).map((r) => ({
          id: r.id,
          section: r.section,
          exerciseId: r.exercise_id,
          mode: r.mode,
          setConfigs: parseSetConfigs(r.set_configs),
          restSeconds: r.rest_seconds,
          notes: r.notes,
        })),
      };
    },
  });
}

/** Domain wording for the codes save_session raises. */
const SAVE_SESSION_ERRORS = {
  stale_write:
    "This day changed while you were editing it. Reload to see the current version before saving.",
  not_found_or_forbidden: "This day no longer exists.",
  invalid_set_config: "One of the sets has a value this app doesn't recognize.",
};

export function describeSaveSessionError(error: unknown): string {
  return describeRpcError(error, SAVE_SESSION_ERRORS);
}

export interface SaveSessionInput {
  sessionId: string;
  name: string;
  description: string;
  estimatedDurationMinutes: number | undefined;
  warmupName: string | null;
  exercises: {
    section: SessionSection;
    exerciseId: string | null;
    mode: ExerciseMode;
    setConfigs: SetConfig[];
    restSeconds: number | null;
    notes: string | null;
  }[];
  /** The sessions.updated_at this editor loaded; a competing save raises stale_write (C3). */
  expectedUpdatedAt?: string | null;
}

/**
 * Saves one scheduled day.
 *
 * Touches exactly one day — no other week, no other client, and never the
 * library workout it was built from. Pushing the change onto later days is
 * `useApplySessionToFuture`, a separate and deliberate action (R9).
 */
export function useSaveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveSessionInput) => {
      const { data, error } = await supabase.rpc("save_session", {
        p_session_id: input.sessionId,
        p_expected_updated_at: input.expectedUpdatedAt ?? undefined,
        p_payload: {
          name: input.name,
          description: input.description || null,
          estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
          warmup_name: input.warmupName,
          exercises: input.exercises.map((ex) => ({
            section: ex.section,
            exercise_id: ex.exerciseId,
            mode: ex.mode,
            set_configs: serializeSetConfigs(ex.setConfigs),
            rest_seconds: ex.restSeconds,
            notes: ex.notes,
          })),
        },
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: qk.sessionDetail(input.sessionId) });
      // The coach's program view and the client's day both read this row (R6).
      void queryClient.invalidateQueries({ queryKey: qk.programs() });
      void queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
    },
  });
}

export interface ApplyResult {
  applied: number;
  skipped_past: number;
  skipped_logged: number;
  session_ids: string[];
}

const APPLY_ERRORS = {
  no_source_workout:
    "This day was built from scratch, so there's nothing to match it to in later weeks.",
  not_found_or_forbidden: "This day no longer exists.",
};

export function describeApplyError(error: unknown): string {
  return describeRpcError(error, APPLY_ERRORS);
}

/**
 * Pushes one day's contents onto the client's LATER days built from the same
 * library workout.
 *
 * Explicit and opt-in: data-model.md is clear that fanning a change out
 * beyond the row in hand is a deliberate action, never a side effect of
 * saving. The RPC skips any day the client has already reached (their today,
 * not the coach's) and any day that already has a log, and returns counts so
 * this can report what it did rather than claiming success.
 *
 * Requires connectivity — its meaning depends on current server state, so it
 * must never queue offline (S3).
 */
export function useApplySessionToFuture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; includeWarmup?: boolean }) => {
      const { data, error } = await supabase.rpc("apply_session_to_future", {
        p_session_id: input.sessionId,
        p_include_warmup: input.includeWarmup ?? true,
      });
      if (error) throw new Error(error.message);
      return data as unknown as ApplyResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.programs() });
      void queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
    },
    networkMode: "online",
  });
}

const SAVE_AS_WORKOUT_ERRORS = {
  not_your_client: "That client isn't one of yours.",
  not_found_or_forbidden: "This day no longer exists.",
};

export function describeSaveAsWorkoutError(error: unknown): string {
  return describeRpcError(error, SAVE_AS_WORKOUT_ERRORS);
}

/**
 * Files one scheduled day in the library as a reusable workout — globally, or
 * on one client's shelf. The day itself is untouched.
 */
export function useSaveSessionAsWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; clientId?: string | null; name?: string }) => {
      const { data, error } = await supabase.rpc("save_session_as_workout", {
        p_session_id: input.sessionId,
        p_client_id: input.clientId ?? undefined,
        p_name: input.name || undefined,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.workouts() });
    },
  });
}
