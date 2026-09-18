import { useQuery } from "@tanstack/react-query";
import type { Workout, WorkoutExercise, WorkoutLog, ExerciseLog, SetLog } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";
import type { LastSetWeights } from "../../components/workout/resolveTargetWeight";

export type ExerciseLogWithSets = ExerciseLog & { set_logs: SetLog[] };
export type WorkoutLogWithChildren = WorkoutLog & { exercise_logs: ExerciseLogWithSets[] };

/**
 * `workout_exercises` has no name column of its own — it only FKs to
 * `exercises.name` (or is a freeform notes-only row when exercise_id is
 * null). The RPC attaches the joined exercise so the logger and warmup card
 * have a display name.
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
  /** The client's most recent completed log before this date, in any workout. */
  previousLog: WorkoutLogWithChildren | null;
  /**
   * Per-exercise last logged weights, for resolving `weightDelta` targets:
   * `{exercise_id: {set_number: {weight, weight_unit}}}`.
   *
   * Distinct from `previousLog`, which is one SESSION and so misses any
   * exercise that session did not contain — on a split routine that is most
   * of them. Only sets the client actually typed a weight into appear here
   * (P2): progressing someone off a bare check-off is the failure P2 exists
   * to prevent.
   */
  lastSetWeights: LastSetWeights;
  /** Whether `date` falls within the assignment's active window. */
  inRange: boolean;
  /** Program window bounds, for MoveWorkoutCard's date-picker clamp. */
  programStartDate: string;
  programEndDate: string;
}

/** The shape `get_workout_day` returns; snake_case, straight from SQL. */
interface WorkoutDayPayload {
  workout: Workout | null;
  exercises: WorkoutExerciseWithName[];
  warmup: Workout | null;
  warmup_exercises: WorkoutExerciseWithName[];
  log: WorkoutLogWithChildren | null;
  previous_log: WorkoutLogWithChildren | null;
  last_set_weights: LastSetWeights | null;
  in_range: boolean;
  program_start_date: string | null;
  program_end_date: string | null;
}

/**
 * Everything the day view renders, in ONE round trip.
 *
 * This used to be a four-level waterfall — load the assignment context (four
 * sequential reads of its own), then the log, then the workout/exercises/
 * previous log, then the warmup pair — with the schedule resolved by a
 * client-side mirror of the SQL resolver. The mirror existed only because
 * `resolve_scheduled_workout` was not callable from the client; now that
 * `get_workout_day` exposes it, resolution happens in exactly one place
 * (violations S-4, B9).
 */
export function useWorkoutDay(uid: string | undefined, date: string | undefined) {
  return useQuery<WorkoutDayResult | null>({
    queryKey: qk.workoutDay(uid ?? "", date ?? ""),
    enabled: Boolean(uid) && Boolean(date),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_workout_day", { p_date: date as string });
      if (error) throw new Error(error.message);

      const payload = data as unknown as WorkoutDayPayload;
      return {
        workout: payload.workout,
        exercises: payload.exercises ?? [],
        warmup: payload.warmup,
        warmupExercises: payload.warmup_exercises ?? [],
        log: payload.log,
        previousLog: payload.previous_log,
        lastSetWeights: payload.last_set_weights ?? {},
        inRange: payload.in_range,
        // Fall back to the requested date when the client has no assignment:
        // the date picker still needs a bound to clamp against.
        programStartDate: payload.program_start_date ?? (date as string),
        programEndDate: payload.program_end_date ?? (date as string),
      };
    },
  });
}
