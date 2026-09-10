import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseDateStr } from "@momentum/shared";
import type {
  BodyMeasurement,
  ClientSummary,
  ExerciseLog,
  Profile,
  Program,
  SetLog,
  Workout,
  WorkoutLog,
} from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/** One completed (or in-progress) workout log, with its exercises/sets nested for the RecentWorkouts panel. */
export interface WorkoutLogWithSets extends WorkoutLog {
  exercise_logs: (ExerciseLog & { set_logs: SetLog[] })[];
}

/** Header-card program status: either no program, or the active assignment's program + current week. */
export type ProgramStatus =
  | { kind: "none" }
  | { kind: "not_started"; program: Program; startDateStr: string }
  | {
      kind: "active";
      program: Program;
      currentWeek: number;
      totalWeeks: number;
      /** Elapsed share of the program, 0-100. Null when the program has no week count to divide by. */
      progressPercent: number | null;
    };

export interface ClientDetail {
  profile: Profile;
  /** Streak comes from `client_summaries` — trigger-maintained by `compute_streak` (plan finding #8), never re-derived here. */
  streak: number;
  programStatus: ProgramStatus;
  /** Last 12 weeks (84 days) of workout logs, for the heatmap + recent-workouts list, newest first. */
  logs: WorkoutLogWithSets[];
  workoutsById: Map<string, Workout>;
  measurements: BodyMeasurement[];
}

const HEATMAP_DAYS = 84; // 12 weeks

function resolveProgramStatus(
  assignment: { start_date: string; programs: Program | null } | null,
  /** The CLIENT's today (YYYY-MM-DD) — not the coach's. See concurrency.md C1. */
  todayStr: string
): ProgramStatus {
  if (!assignment || !assignment.programs) return { kind: "none" };
  const program = assignment.programs;
  const totalWeeks = program.weeks ?? 0;

  const start = parseDateStr(assignment.start_date);
  const today = parseDateStr(todayStr);
  if (!start || !today) return { kind: "none" };

  if (today.getTime() < start.getTime()) {
    return { kind: "not_started", program, startDateStr: assignment.start_date };
  }

  const daysDiff = Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const currentWeek = Math.min(Math.floor(daysDiff / 7) + 1, Math.max(totalWeeks, 1));
  // Elapsed time, not workouts completed — the header states where the client
  // is in the plan, and a coach reading "33% complete" next to "Week 3 of 6"
  // expects the two to agree. Capped at 100 so an overrun program doesn't
  // report 120%.
  const progressPercent =
    totalWeeks > 0 ? Math.min(100, Math.round((daysDiff / (totalWeeks * 7)) * 100)) : null;
  return { kind: "active", program, currentWeek, totalWeeks, progressPercent };
}

/**
 * EXEMPLAR-style batched query for the client detail page (Wave 9.2). Loads
 * everything the page needs in one query so header/heatmap/recent-workouts/
 * measurements render together rather than each panel independently
 * waterfalling its own fetch. `streak` and program status both come from
 * this one payload (streak off `client_summaries`, trigger-maintained by
 * `compute_streak` — never re-derived client-side).
 *
 * Goals and progress photos are deliberately NOT included here — they get
 * their own hooks (`useClientGoals`, `useClientProgressPhotos`) because
 * they're mutated far more often (lock/archive/add) than the rest of this
 * payload. Goal mutations invalidate both `qk.clientGoals` and
 * `qk.clientDetail` (the latter for the header's live goal-count-derived
 * `client_summaries` fields) — see useClientGoals.ts.
 *
 * No client-side `coach_id = auth.uid()` filter anywhere below — RLS scopes
 * every one of these tables to `is_coach_of(client_id)` already.
 */
export function useClientDetail(clientId: string | undefined, todayStr: string) {
  return useQuery<ClientDetail>({
    queryKey: qk.clientDetail(clientId ?? "", todayStr),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const id = clientId as string;

      const [profileRes, summaryRes, assignmentRes, logsRes, measurementsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", id).single(),
        supabase.from("client_summaries").select("*").eq("client_id", id).maybeSingle(),
        supabase
          .from("assignments")
          .select("start_date, programs(*)")
          .eq("client_id", id)
          .eq("active", true)
          .maybeSingle(),
        supabase
          .from("workout_logs")
          .select("*, exercise_logs(*, set_logs(*))")
          .eq("client_id", id)
          .order("date", { ascending: false })
          .limit(HEATMAP_DAYS),
        supabase
          .from("body_measurements")
          .select("*")
          .eq("client_id", id)
          .order("date", { ascending: false })
          .limit(20),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (summaryRes.error) throw summaryRes.error;
      if (assignmentRes.error) throw assignmentRes.error;
      if (logsRes.error) throw logsRes.error;
      if (measurementsRes.error) throw measurementsRes.error;

      const summary = summaryRes.data as ClientSummary | null;

      const logs = (logsRes.data ?? []) as unknown as WorkoutLogWithSets[];

      // Workouts are fetched for their NAME only. Targets come from each
      // set's own `prescribed` snapshot — see WorkoutLogWithSets.
      const workoutIds = [...new Set(logs.map((l) => l.workout_id).filter((v): v is string => Boolean(v)))];
      let workoutsById = new Map<string, Workout>();
      if (workoutIds.length > 0) {
        const { data: workouts, error: workoutsError } = await supabase
          .from("workouts")
          .select("*")
          .in("id", workoutIds);
        if (workoutsError) throw workoutsError;
        workoutsById = new Map((workouts ?? []).map((w) => [w.id, w]));
      }

      return {
        profile: profileRes.data,
        streak: summary?.streak ?? 0,
        programStatus: resolveProgramStatus(
          assignmentRes.data as { start_date: string; programs: Program | null } | null,
          todayStr
        ),
        logs,
        workoutsById,
        measurements: measurementsRes.data ?? [],
      };
    },
  });
}

/**
 * Toggles `profiles.disabled` for a client. Used by both ClientsPage's
 * roster toggle and ClientDetailPage's header action — invalidates both the
 * detail cache and the summaries list (disabled affects the dashboard grid's
 * dimmed state and its attention sort).
 */
export function useToggleClientDisabled(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (nextDisabled: boolean) => {
      const { error } = await supabase
        .from("profiles")
        .update({ disabled: nextDisabled })
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.clientDetail(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
    },
  });
}

/** The three override columns a coach edits together on the client detail page. */
export interface MotivationOverrideInput {
  quote: string;
  imageUrl: string;
  until: string;
}

/**
 * Saves this client's motivation override (profiles.motivation_override_*).
 * Instance-tier write: scoped to one client id, so it can never change what
 * another client sees — the coach-wide weekly card in `motivation_entries`
 * is a separate row and is untouched here.
 *
 * Empty strings are normalized to null so "cleared" is a real null in the
 * database rather than an empty string the mobile resolver would have to
 * special-case. Invalidates `qk.clientDetail` (the form seeds from that
 * payload's profile) — the client-side key is `qk.dashboard(clientId)` in
 * apps/mobile, which realtime on `profiles` refreshes (R6).
 */
export function useSaveMotivationOverride(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ quote, imageUrl, until }: MotivationOverrideInput) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          motivation_override_quote: quote.trim() || null,
          motivation_override_image_url: imageUrl.trim() || null,
          motivation_override_until: until.trim() || null,
        })
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.clientDetail(clientId) });
    },
  });
}

/**
 * Sends this client a password-reset email, from the coach's header-card
 * menu. Uses the same `resetPasswordForEmail` path as ForgotPasswordPage, so
 * the link lands on /reset-password.
 *
 * No cache invalidation: sending mail changes nothing this app reads. Resend
 * invite is deliberately NOT here — it needs an Edge Function to mint the
 * signup link (see ClientsPage's InviteClientStub), which is still post-MVP.
 */
export function useSendPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    },
  });
}
