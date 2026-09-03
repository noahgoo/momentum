import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DayOfWeek, WeekSchedule } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/**
 * Coach's program library list. No client-side `created_by` filter — RLS
 * already scopes `programs` reads to this coach's own rows (per the
 * README's rule against redundant coach filters). Only library programs
 * (client_id is null) are listed here — per-client copies are edited from
 * the assign flow, out of scope for this builder (see NON-GOALS).
 */
export interface ProgramListRow {
  id: string;
  name: string;
  description: string | null;
  weeks: number | null;
  phaseCount: number;
}

export function usePrograms() {
  return useQuery<ProgramListRow[]>({
    queryKey: qk.programs(),
    queryFn: async () => {
      const { data: programs, error } = await supabase
        .from("programs")
        .select("*")
        .is("client_id", null)
        .order("name", { ascending: true });
      if (error) throw error;

      const programIds = (programs ?? []).map((p) => p.id);
      const phaseCounts: Record<string, number> = {};
      if (programIds.length > 0) {
        const { data: phases, error: phasesError } = await supabase
          .from("program_phases")
          .select("id, program_id")
          .in("program_id", programIds);
        if (phasesError) throw phasesError;
        for (const row of phases ?? []) {
          phaseCounts[row.program_id] = (phaseCounts[row.program_id] ?? 0) + 1;
        }
      }

      return (programs ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        weeks: p.weeks,
        phaseCount: phaseCounts[p.id] ?? 0,
      }));
    },
  });
}

/** Raised instead of a raw foreign-key error when clients depend on a program. */
export class ProgramInUseError extends Error {
  constructor(public readonly assignmentCount: number) {
    super(
      assignmentCount === 1
        ? "1 client is assigned to this program."
        : `${assignmentCount} clients are assigned to this program.`
    );
    this.name = "ProgramInUseError";
  }
}

/**
 * Deletes a program, checking first what depends on it so the coach sees
 * "3 clients are assigned to this program" rather than a raw 23503 (R4).
 * The FK is `on delete restrict`, so this check is a better error message,
 * not the safety mechanism — the database refuses either way.
 */
export function useDeleteProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (programId: string) => {
      const { data: blockers, error: blockersError } = await supabase.rpc(
        "program_delete_blockers",
        { p_program_id: programId }
      );
      if (blockersError) throw new Error(blockersError.message);
      if ((blockers ?? 0) > 0) throw new ProgramInUseError(blockers as number);

      const { error } = await supabase.from("programs").delete().eq("id", programId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.programs() });
    },
  });
}

/**
 * Duplicates a program via the `duplicate_program` RPC.
 *
 * This was ~100 lines of client-side tree walking — insert the program, the
 * phases, remap phase ids by sort_order, then branch on phased vs flat to
 * copy week_schedules. The RPC shares `copy_program_tree` with
 * `assign_program`, so there is one implementation of the copy instead of two
 * that can drift apart.
 */
export function useDuplicateProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (programId: string) => {
      const { data, error } = await supabase.rpc("duplicate_program", { p_program_id: programId });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.programs() });
    },
  });
}

// ---------------------------------------------------------------------------
// Program detail (builder edit mode)
// ---------------------------------------------------------------------------

/** Builder-local shape for one phase: fields the UI edits before save. `id` is a DB row id (existing phase) or a client-generated id (new phase) — used as SortableList drag identity. */
export interface BuilderPhase {
  id: string;
  name: string;
  weeks: number;
  activeDays: DayOfWeek[];
  /** Phase-LOCAL week schedule: week keys start at 1 within this phase. */
  weekSchedule: WeekSchedule;
}

export interface ProgramDetail {
  id: string;
  name: string;
  description: string | null;
  weeks: number | null;
  phased: boolean;
  phases: BuilderPhase[];
  /** Flat-mode fields, only meaningful when `phased` is false. */
  flatActiveDays: DayOfWeek[];
  flatWeekSchedule: WeekSchedule;
}

/** Loads one program plus its phases (if any) and week_schedules, for the builder's edit mode. */
export function useProgramDetail(programId: string | undefined) {
  return useQuery<ProgramDetail | null>({
    queryKey: programId ? qk.programDetail(programId) : qk.programDetail("__none__"),
    queryFn: async () => {
      if (!programId) return null;

      const { data: program, error: programError } = await supabase
        .from("programs")
        .select("*")
        .eq("id", programId)
        .single();
      if (programError) throw programError;

      const { data: phases, error: phasesError } = await supabase
        .from("program_phases")
        .select("*")
        .eq("program_id", programId)
        .order("sort_order", { ascending: true });
      if (phasesError) throw phasesError;

      const phased = (phases ?? []).length > 0;

      if (phased) {
        const phaseIds = (phases ?? []).map((p) => p.id);
        const { data: weekSchedules, error: weekSchedulesError } = await supabase
          .from("week_schedules")
          .select("*")
          .in("phase_id", phaseIds);
        if (weekSchedulesError) throw weekSchedulesError;

        const scheduleByPhase = new Map<string, WeekSchedule>();
        for (const row of weekSchedules ?? []) {
          if (!row.phase_id || !row.workout_id) continue;
          const schedule = scheduleByPhase.get(row.phase_id) ?? {};
          const week = schedule[String(row.week_number)] ?? {};
          week[row.day_of_week] = row.workout_id;
          schedule[String(row.week_number)] = week;
          scheduleByPhase.set(row.phase_id, schedule);
        }

        return {
          id: program.id,
          name: program.name,
          description: program.description,
          weeks: program.weeks,
          phased: true,
          phases: (phases ?? []).map((p) => ({
            id: p.id,
            name: p.name ?? "",
            weeks: p.weeks ?? 1,
            activeDays: (p.active_days ?? []) as DayOfWeek[],
            weekSchedule: scheduleByPhase.get(p.id) ?? {},
          })),
          flatActiveDays: [],
          flatWeekSchedule: {},
        };
      }

      const { data: weekSchedules, error: weekSchedulesError } = await supabase
        .from("week_schedules")
        .select("*")
        .eq("program_id", programId);
      if (weekSchedulesError) throw weekSchedulesError;

      const flatWeekSchedule: WeekSchedule = {};
      const activeDaySet = new Set<DayOfWeek>();
      for (const row of weekSchedules ?? []) {
        if (!row.workout_id) continue;
        const week = flatWeekSchedule[String(row.week_number)] ?? {};
        week[row.day_of_week] = row.workout_id;
        flatWeekSchedule[String(row.week_number)] = week;
        activeDaySet.add(row.day_of_week);
      }

      return {
        id: program.id,
        name: program.name,
        description: program.description,
        weeks: program.weeks,
        phased: false,
        phases: [],
        flatActiveDays: Array.from(activeDaySet),
        flatWeekSchedule,
      };
    },
    enabled: !!programId,
  });
}

export interface SaveProgramInput {
  programId?: string; // undefined => create
  name: string;
  description: string;
  createdBy: string;
  phased: boolean;
  phases: BuilderPhase[]; // in final display order (phased mode only)
  flatWeeks: number; // flat mode only
  flatActiveDays: DayOfWeek[]; // flat mode only (informational; schedule rows are the source of truth)
  flatWeekSchedule: WeekSchedule; // flat mode only
}

/**
 * Saves a program: upsert the `programs` row (weeks = sum of phase weeks in
 * phased mode, or the explicit flat weeks input otherwise), then replace
 * `program_phases` + `week_schedules` wholesale (delete-then-insert, same
 * pattern as `useSaveWorkout`'s workout_exercises replacement).
 *
 * Week-number scoping (documented per the task's numbering requirement):
 * - Phased mode: each `week_schedules` row carries `phase_id` (never
 *   `program_id`) and `week_number` is PHASE-LOCAL, starting at 1 within
 *   that phase — matching the seeded Foundation program's convention and
 *   `resolveWeekSchedule`'s phase-flattening contract (packages/shared
 *   schedule.ts), which re-derives global week numbers by summing prior
 *   phases' `weeks` at read time. Phase-local numbering means reordering
 *   phases or changing an earlier phase's week count never requires
 *   renumbering later phases' schedule rows.
 * - Flat mode: each `week_schedules` row carries `program_id` (never
 *   `phase_id`) and `week_number` is GLOBAL (1..weeks), since there are no
 *   phases to offset from.
 */
export function useSaveProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveProgramInput) => {
      const weeks = input.phased
        ? input.phases.reduce((sum, phase) => sum + (phase.weeks || 0), 0)
        : input.flatWeeks;

      const programPayload = {
        name: input.name,
        description: input.description || null,
        weeks,
        created_by: input.createdBy,
      };

      let programId = input.programId;
      if (programId) {
        const { error } = await supabase.from("programs").update(programPayload).eq("id", programId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("programs")
          .insert(programPayload)
          .select("id")
          .single();
        if (error) throw error;
        programId = data.id;
      }

      // Replace program_phases wholesale. Deleting phases cascades their
      // week_schedules rows (phase_id references program_phases on delete
      // cascade), so no separate phase-scoped week_schedules delete is
      // needed before re-inserting.
      const { error: deletePhasesError } = await supabase
        .from("program_phases")
        .delete()
        .eq("program_id", programId);
      if (deletePhasesError) throw deletePhasesError;

      // Flat-mode week_schedules rows are program-scoped, not cascaded by
      // the phase delete above — clear them explicitly so switching modes
      // (or re-saving flat) never leaves stale rows behind.
      const { error: deleteFlatSchedulesError } = await supabase
        .from("week_schedules")
        .delete()
        .eq("program_id", programId)
        .is("phase_id", null);
      if (deleteFlatSchedulesError) throw deleteFlatSchedulesError;

      if (input.phased) {
        if (input.phases.length > 0) {
          const { data: insertedPhases, error: insertPhasesError } = await supabase
            .from("program_phases")
            .insert(
              input.phases.map((phase, index) => ({
                program_id: programId,
                name: phase.name || null,
                sort_order: index,
                weeks: phase.weeks,
                active_days: phase.activeDays,
              })),
            )
            .select("id")
            .order("sort_order", { ascending: true });
          if (insertPhasesError) throw insertPhasesError;

          const scheduleRows: {
            phase_id: string;
            week_number: number;
            day_of_week: DayOfWeek;
            workout_id: string;
          }[] = [];
          input.phases.forEach((phase, index) => {
            const phaseId = insertedPhases?.[index]?.id;
            if (!phaseId) return;
            for (const [weekKey, daySchedule] of Object.entries(phase.weekSchedule)) {
              const weekNumber = Number(weekKey);
              if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > phase.weeks) continue;
              for (const [day, workoutId] of Object.entries(daySchedule)) {
                if (!workoutId) continue; // empty/rest -> no row
                scheduleRows.push({
                  phase_id: phaseId,
                  week_number: weekNumber,
                  day_of_week: day as DayOfWeek,
                  workout_id: workoutId,
                });
              }
            }
          });

          if (scheduleRows.length > 0) {
            const { error: insertSchedulesError } = await supabase
              .from("week_schedules")
              .insert(scheduleRows);
            if (insertSchedulesError) throw insertSchedulesError;
          }
        }
      } else {
        const scheduleRows: {
          program_id: string;
          week_number: number;
          day_of_week: DayOfWeek;
          workout_id: string;
        }[] = [];
        for (const [weekKey, daySchedule] of Object.entries(input.flatWeekSchedule)) {
          const weekNumber = Number(weekKey);
          if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > input.flatWeeks) continue;
          for (const [day, workoutId] of Object.entries(daySchedule)) {
            if (!workoutId) continue;
            scheduleRows.push({
              program_id: programId,
              week_number: weekNumber,
              day_of_week: day as DayOfWeek,
              workout_id: workoutId,
            });
          }
        }

        if (scheduleRows.length > 0) {
          const { error: insertSchedulesError } = await supabase
            .from("week_schedules")
            .insert(scheduleRows);
          if (insertSchedulesError) throw insertSchedulesError;
        }
      }

      return programId;
    },
    onSuccess: (programId) => {
      void queryClient.invalidateQueries({ queryKey: qk.programDetail(programId) });
      void queryClient.invalidateQueries({ queryKey: qk.programs() });
    },
  });
}
