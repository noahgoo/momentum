import { useQuery } from "@tanstack/react-query";
import type { Workout, WorkoutExercise, WorkoutLog, ExerciseLog, SetLog } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { loadActiveAssignmentContext } from "./assignmentContext";

export type ExerciseLogWithSets = ExerciseLog & { set_logs: SetLog[] };
export type WorkoutLogWithChildren = WorkoutLog & { exercise_logs: ExerciseLogWithSets[] };

/**
 * `workout_exercises` has no name column of its own — it only FKs to
 * `exercises.name` (or is a freeform notes-only row when exercise_id is
 * null). The logger/warmup card need a display name, so every fetch of
 * workout_exercises here joins `exercises(name, video_url)`.
 */
export type WorkoutExerciseWithName = WorkoutExercise & {
  exercises: { name: string; video_url: string | null } | null;
};

export interface WorkoutDayResult {
  /** null when this date is a rest day / no active assignment / nothing scheduled. */
  workout: Workout | null;
  exercises: WorkoutExerciseWithName[];
  warmup: Workout | null;
  warmupExercises: WorkoutExerciseWithName[];
  /** This date's workout_logs row (with children), if one exists yet. */
  log: WorkoutLogWithChildren | null;
  /** The client's most recent completed log before this date, in any workout — for "last time" ghost values, paired by exercise. */
  previousLog: WorkoutLogWithChildren | null;
  /** Whether `date` falls within the assignment's active window. */
  inRange: boolean;
  /** Program window bounds, for MoveWorkoutCard's date-picker clamp. */
  programStartDate: string;
  programEndDate: string;
}

const LOG_SELECT = "*, exercise_logs(*, set_logs(*))";

/**
 * Composite query for the day view ([date].tsx). Resolves the same way
 * useTodayWorkout does (client-side mirror of resolve_scheduled_workout via
 * getWorkoutIdForDate — see assignmentContext.ts), but for an arbitrary
 * `date` rather than always "today", and additionally loads:
 *  - the linked warmup workout + its exercises (workouts.warmup_id)
 *  - this date's log (if any), including exercise_logs/set_logs children
 *  - the previous log for the same workout_id (for "last time" ghosts)
 */
export function useWorkoutDay(uid: string | undefined, date: string | undefined) {
  return useQuery<WorkoutDayResult | null>({
    queryKey: qk.workoutDay(uid ?? "", date ?? ""),
    enabled: Boolean(uid) && Boolean(date),
    queryFn: async () => {
      const clientId = uid as string;
      const targetDate = date as string;

      const ctx = await loadActiveAssignmentContext(clientId);

      const logPromise = supabase
        .from("workout_logs")
        .select(LOG_SELECT)
        .eq("client_id", clientId)
        .eq("date", targetDate)
        .maybeSingle();

      if (!ctx) {
        const { data: log, error: logError } = await logPromise;
        if (logError) throw logError;
        return {
          workout: null,
          exercises: [],
          warmup: null,
          warmupExercises: [],
          log: (log as WorkoutLogWithChildren | null) ?? null,
          previousLog: null,
          inRange: false,
          programStartDate: targetDate,
          programEndDate: targetDate,
        };
      }

      const workoutId = ctx.resolveDate(targetDate);
      const inRange = targetDate >= ctx.startDateStr && targetDate <= ctx.endDateStr;

      const { data: log, error: logError } = await logPromise;
      if (logError) throw logError;

      if (!workoutId) {
        return {
          workout: null,
          exercises: [],
          warmup: null,
          warmupExercises: [],
          log: (log as WorkoutLogWithChildren | null) ?? null,
          previousLog: null,
          inRange,
          programStartDate: ctx.startDateStr,
          programEndDate: ctx.endDateStr,
        };
      }

      const [
        { data: workout, error: workoutError },
        { data: exercises, error: exercisesError },
        { data: previousLog, error: previousLogError },
      ] = await Promise.all([
        supabase.from("workouts").select("*").eq("id", workoutId).maybeSingle(),
        supabase
          .from("workout_exercises")
          .select("*, exercises(name, video_url)")
          .eq("workout_id", workoutId)
          .order("sort_order", { ascending: true }),
        // "Last time" means the last time this client did these EXERCISES,
        // in any workout — not the last time they did this same workout row.
        // Scoping by workout_id blanked the column after a reassign (P-4),
        // and the logger already pairs prior sets by exercise_id anyway.
        supabase
          .from("workout_logs")
          .select(LOG_SELECT)
          .eq("client_id", clientId)
          .eq("completed", true)
          .lt("date", targetDate)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (workoutError) throw workoutError;
      if (exercisesError) throw exercisesError;
      if (previousLogError) throw previousLogError;

      let warmup: Workout | null = null;
      let warmupExercises: WorkoutExerciseWithName[] = [];
      if (workout?.warmup_id) {
        const [{ data: warmupRow, error: warmupError }, { data: warmupEx, error: warmupExError }] =
          await Promise.all([
            supabase.from("workouts").select("*").eq("id", workout.warmup_id).maybeSingle(),
            supabase
              .from("workout_exercises")
              .select("*, exercises(name, video_url)")
              .eq("workout_id", workout.warmup_id)
              .order("sort_order", { ascending: true }),
          ]);
        if (warmupError) throw warmupError;
        if (warmupExError) throw warmupExError;
        warmup = warmupRow ?? null;
        warmupExercises = (warmupEx ?? []) as WorkoutExerciseWithName[];
      }

      return {
        workout: workout ?? null,
        exercises: (exercises ?? []) as WorkoutExerciseWithName[],
        warmup,
        warmupExercises,
        log: (log as WorkoutLogWithChildren | null) ?? null,
        previousLog: (previousLog as WorkoutLogWithChildren | null) ?? null,
        inRange,
        programStartDate: ctx.startDateStr,
        programEndDate: ctx.endDateStr,
      };
    },
  });
}
