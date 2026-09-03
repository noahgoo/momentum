import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseDateStr, parseSetConfigs, type SetConfig } from "@momentum/shared";
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
  | { kind: "active"; program: Program; currentWeek: number; totalWeeks: number };

/** Key for `targetsByWorkoutExercise`: `${workoutId}:${exerciseId}`. */
export type WorkoutExerciseTargetKey = string;

export interface ClientDetail {
  profile: Profile;
  /** Streak comes from `client_summaries` — trigger-maintained by `compute_streak` (plan finding #8), never re-derived here. */
  streak: number;
  programStatus: ProgramStatus;
  /** Last 12 weeks (84 days) of workout logs, for the heatmap + recent-workouts list, newest first. */
  logs: WorkoutLogWithSets[];
  workoutsById: Map<string, Workout>;
  /**
   * Per-set target configs, keyed by `${workoutId}:${exerciseId}`, for
   * RecentWorkouts' target columns. A coach may have since edited/reordered
   * the workout, so a log's exercise may have no matching entry here — that
   * is a normal "targets unavailable" case, not an error.
   */
  targetsByWorkoutExercise: Map<WorkoutExerciseTargetKey, SetConfig[]>;
  measurements: BodyMeasurement[];
}

export function workoutExerciseTargetKey(workoutId: string, exerciseId: string): WorkoutExerciseTargetKey {
  return `${workoutId}:${exerciseId}`;
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
  return { kind: "active", program, currentWeek, totalWeeks };
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

      const workoutIds = [...new Set(logs.map((l) => l.workout_id).filter((v): v is string => Boolean(v)))];
      let workoutsById = new Map<string, Workout>();
      const targetsByWorkoutExercise = new Map<WorkoutExerciseTargetKey, SetConfig[]>();
      if (workoutIds.length > 0) {
        const [{ data: workouts, error: workoutsError }, { data: workoutExercises, error: weError }] =
          await Promise.all([
            supabase.from("workouts").select("*").in("id", workoutIds),
            supabase.from("workout_exercises").select("*").in("workout_id", workoutIds),
          ]);
        if (workoutsError) throw workoutsError;
        if (weError) throw weError;
        workoutsById = new Map((workouts ?? []).map((w) => [w.id, w]));
        for (const we of workoutExercises ?? []) {
          if (!we.exercise_id) continue;
          targetsByWorkoutExercise.set(
            workoutExerciseTargetKey(we.workout_id, we.exercise_id),
            parseSetConfigs(we.set_configs)
          );
        }
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
        targetsByWorkoutExercise,
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
