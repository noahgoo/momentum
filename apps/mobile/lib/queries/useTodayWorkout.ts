import { useQuery } from "@tanstack/react-query";
import {
  getWorkoutIdForDate,
  type DayOfWeek,
  type Program,
  type ProgramPhase,
  type Workout,
  type WorkoutExercise,
  type WorkoutLog,
  type WeekSchedule,
} from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface TodayWorkoutResult {
  /** null when today is a rest day, no active assignment exists, or nothing is scheduled. */
  workout: Workout | null;
  exercises: WorkoutExercise[];
  /** Today's workout_log row, if one exists yet (created on first set/warmup tick). */
  log: WorkoutLog | null;
  streak: number;
}

/**
 * EXEMPLAR composite query — read this before writing any other multi-table
 * hook in this directory.
 *
 * ── Why this shape ─────────────────────────────────────────────────────
 * The single source of truth for "what workout is scheduled today" is the
 * SQL function `resolve_scheduled_workout(client_id, date)` (see plan
 * finding #2 and packages/shared/src/schedule.ts header comment). That
 * function is used by coach-web builder cross-checks and change-request
 * accept/reject. On the client we do NOT call it via RPC for the dashboard
 * read path — instead we fetch the same underlying rows (assignment,
 * override, program + phases + week_schedules) and resolve them locally
 * with the shared `getWorkoutIdForDate` helper. This mirrors the SQL
 * function's logic exactly (same helper is unit-tested against SQL
 * assertion vectors — see packages/shared/src/schedule.test.ts) while
 * avoiding an extra round trip and letting react-query cache/join the
 * pieces independently. If SQL's resolution logic ever changes, update
 * `getWorkoutIdForDate` first — it is the mirrored authority on the client.
 *
 * ── Steps ──────────────────────────────────────────────────────────────
 * (a) `get_my_streak()` RPC — streak is NOT re-derived client-side (plan
 *     decision: one canonical SQL implementation, `compute_streak`).
 * (b) Active assignment for this client, joined to its program.
 * (c) Today's row in `assignment_date_overrides`, if any (wins outright,
 *     including an explicit `null` workout_id meaning "rest").
 * (d) If no override row exists at all, fetch `program_phases` +
 *     `week_schedules` for the program and resolve via
 *     `getWorkoutIdForDate`.
 * (e) Resolved workout id -> `workouts` row + `workout_exercises` rows.
 * (f) Today's `workout_logs` row for this client (completion state).
 *
 * Every branch that finds "nothing scheduled" returns `workout: null`
 * rather than throwing — that's a valid state (rest day / no program).
 */
export function useTodayWorkout(uid: string | undefined, today: string) {
  return useQuery<TodayWorkoutResult>({
    // `today` is part of the key: when the client's date rolls over, that is a
    // different query, not a stale one.
    queryKey: qk.todayWorkout(uid ?? "", today),
    enabled: Boolean(uid),
    queryFn: async () => {
      const clientId = uid as string;

      // (a) streak — canonical SQL, not recomputed here.
      const { data: streak, error: streakError } = await supabase.rpc("get_my_streak");
      if (streakError) throw streakError;

      // (b) active assignment + its program.
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*, programs(*)")
        .eq("client_id", clientId)
        .eq("active", true)
        .maybeSingle();
      if (assignmentError) throw assignmentError;

      const log = await fetchTodayLog(clientId, today);

      if (!assignment || !assignment.programs) {
        return { workout: null, exercises: [], log, streak: streak ?? 0 };
      }

      const program = assignment.programs as Program;

      // (c) today's override row, if any — wins outright over the computed schedule.
      const { data: overrideRow, error: overrideError } = await supabase
        .from("assignment_date_overrides")
        .select("*")
        .eq("assignment_id", assignment.id)
        .eq("date", today)
        .maybeSingle();
      if (overrideError) throw overrideError;

      let workoutId: string | null;

      if (overrideRow) {
        // Override row present (even with workout_id: null) wins outright —
        // null means an explicit rest day.
        workoutId = overrideRow.workout_id;
      } else {
        // (d) no override — resolve from program phases + week schedules.
        const [{ data: phases, error: phasesError }, { data: scheduleRows, error: scheduleError }] =
          await Promise.all([
            supabase
              .from("program_phases")
              .select("*")
              .eq("program_id", program.id)
              .order("sort_order", { ascending: true }),
            supabase.from("week_schedules").select("*").eq("program_id", program.id),
          ]);
        if (phasesError) throw phasesError;
        if (scheduleError) throw scheduleError;

        // Phase-scoped week_schedules (program_id is null on those rows, see
        // 0002 migration's partial-unique split) need a second fetch keyed
        // by phase id when phases exist.
        let phaseScheduleRows = scheduleRows ?? [];
        if (phases && phases.length > 0) {
          const { data: phaseRows, error: phaseRowsError } = await supabase
            .from("week_schedules")
            .select("*")
            .in(
              "phase_id",
              phases.map((p) => p.id)
            );
          if (phaseRowsError) throw phaseRowsError;
          phaseScheduleRows = [...phaseScheduleRows, ...(phaseRows ?? [])];
        }

        workoutId = getWorkoutIdForDate(
          {
            startDate: assignment.start_date,
            program: {
              id: program.id,
              weeks: program.weeks ?? 0,
              weekSchedule: buildWeekSchedule(phaseScheduleRows.filter((r) => !r.phase_id)),
              phases: (phases ?? []).map((phase: ProgramPhase) => ({
                id: phase.id,
                weeks: phase.weeks ?? 0,
                weekSchedule: buildWeekSchedule(
                  phaseScheduleRows.filter((r) => r.phase_id === phase.id)
                ),
              })),
            },
          },
          today
        );
      }

      if (!workoutId) {
        return { workout: null, exercises: [], log, streak: streak ?? 0 };
      }

      // (e) resolved workout + its exercises.
      const [{ data: workout, error: workoutError }, { data: exercises, error: exercisesError }] =
        await Promise.all([
          supabase.from("workouts").select("*").eq("id", workoutId).maybeSingle(),
          supabase
            .from("workout_exercises")
            .select("*")
            .eq("workout_id", workoutId)
            .order("sort_order", { ascending: true }),
        ]);
      if (workoutError) throw workoutError;
      if (exercisesError) throw exercisesError;

      return {
        workout: workout ?? null,
        exercises: exercises ?? [],
        log,
        streak: streak ?? 0,
      };
    },
  });
}

async function fetchTodayLog(clientId: string, today: string): Promise<WorkoutLog | null> {
  const { data, error } = await supabase
    .from("workout_logs")
    .select("*")
    .eq("client_id", clientId)
    .eq("date", today)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * week_schedules rows are one-row-per-(week,day). `getWorkoutIdForDate`
 * wants the WeekSchedule shape (week -> day -> workoutId). Callers pre-filter
 * rows to either the program-scoped set (phase_id null) or a single phase's
 * set, mirroring the partial-unique constraint (a row belongs to a program OR
 * a phase, never both).
 */
function buildWeekSchedule(
  rows: Array<{ week_number: number; day_of_week: DayOfWeek; workout_id: string | null }>
): WeekSchedule {
  const schedule: WeekSchedule = {};
  for (const row of rows) {
    const weekKey = String(row.week_number);
    if (!schedule[weekKey]) schedule[weekKey] = {};
    if (row.workout_id) {
      schedule[weekKey][row.day_of_week] = row.workout_id;
    }
  }
  return schedule;
}
