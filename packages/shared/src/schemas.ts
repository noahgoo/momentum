/**
 * Zod input-validation schemas for app-facing write payloads. These validate
 * shape/bounds at the app boundary (mobile + coach-web forms and mutations);
 * Postgres constraints/RLS remain the source of truth server-side.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const DAY_OF_WEEK_VALUES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const dayOfWeekSchema = z.enum(DAY_OF_WEEK_VALUES);

export const sexSchema = z.enum(["male", "female"]);

export const weightUnitSchema = z.enum(["lbs", "kg"]);

export const exerciseModeSchema = z.enum(["reps", "time", "distance"]);

export const workoutTypeSchema = z.enum(["workout", "warmup"]);

/** YYYY-MM-DD date string (user-tz calendar date, per plan finding #11). */
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date string");

/** HH:MM 24-hour time string (profiles.notification_time). */
const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be an HH:MM 24-hour time string");

/** Minimal non-empty IANA timezone identifier check (e.g. "America/New_York"). */
const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1, "timezone is required")
  .refine((tz) => tz.includes("/") || tz === "UTC", {
    message: "must be an IANA timezone identifier (e.g. America/New_York)",
  });

// ---------------------------------------------------------------------------
// profileSettingsUpdate
// ---------------------------------------------------------------------------

export const profileSettingsUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  notificationTime: timeStringSchema,
  notificationsEnabled: z.boolean(),
  heightIn: z.number().min(20).max(96).optional(),
  sex: sexSchema.optional(),
  timezone: ianaTimezoneSchema,
});

export type ProfileSettingsUpdate = z.infer<typeof profileSettingsUpdateSchema>;

// ---------------------------------------------------------------------------
// goalCreate
// ---------------------------------------------------------------------------

export const goalCreateSchema = z.object({
  text: z.string().trim().min(1).max(200),
});

export type GoalCreate = z.infer<typeof goalCreateSchema>;

// ---------------------------------------------------------------------------
// messageSend
// ---------------------------------------------------------------------------

export const messageSendSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

export type MessageSend = z.infer<typeof messageSendSchema>;

// ---------------------------------------------------------------------------
// changeRequestCreate
// ---------------------------------------------------------------------------

export const changeRequestCreateSchema = z
  .object({
    fromDate: dateStringSchema,
    toDate: dateStringSchema,
  })
  .refine((data) => data.fromDate !== data.toDate, {
    message: "fromDate and toDate must differ",
    path: ["toDate"],
  });

export type ChangeRequestCreate = z.infer<typeof changeRequestCreateSchema>;

// ---------------------------------------------------------------------------
// setConfig + workoutExerciseInput
// ---------------------------------------------------------------------------

export const setConfigSchema = z.object({
  reps: z.number().int().positive().optional(),
  weight: z.number().nonnegative().finite().optional(),
  weightUnit: weightUnitSchema.optional(),
  seconds: z.number().positive().finite().optional(),
  miles: z.number().positive().finite().optional(),
  paceSeconds: z.number().positive().finite().optional(),
  perSide: z.boolean().optional(),
  // Signed, unlike `weight`: "-5 from last" is a deload, a real prescription.
  // The resolved target it produces is clamped at 0 so it still satisfies
  // `weight`'s nonnegative rule above.
  weightDelta: z.number().finite().optional(),
});

export type SetConfigInput = z.infer<typeof setConfigSchema>;

export const workoutExerciseInputSchema = z.object({
  exerciseId: z.string().uuid().nullable().optional(),
  mode: exerciseModeSchema,
  setConfigs: z.array(setConfigSchema).min(1).max(20),
  restSeconds: z.number().int().min(0).max(900).optional(),
  notes: z.string().max(500).optional(),
});

export type WorkoutExerciseInput = z.infer<typeof workoutExerciseInputSchema>;

// ---------------------------------------------------------------------------
// workoutCreate
// ---------------------------------------------------------------------------

export const workoutCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  type: workoutTypeSchema,
  estimatedDurationMinutes: z.number().int().min(1).max(300).optional(),
  equipment: z.array(z.string().trim().min(1)).max(20).optional(),
  warmupId: z.string().uuid().nullable().optional(),
  exercises: z.array(workoutExerciseInputSchema).optional(),
});

export type WorkoutCreate = z.infer<typeof workoutCreateSchema>;

// ---------------------------------------------------------------------------
// programCreate
// ---------------------------------------------------------------------------

const programPhaseInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  weeks: z.number().int().min(1),
  activeDays: z.array(dayOfWeekSchema),
});

export const programCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  weeks: z.number().int().min(1).max(52),
  phases: z.array(programPhaseInputSchema).optional(),
});

export type ProgramCreate = z.infer<typeof programCreateSchema>;

// ---------------------------------------------------------------------------
// bodyMeasurementCreate
// ---------------------------------------------------------------------------

const positiveFiniteCapped = (max: number) => z.number().positive().finite().max(max);

export const bodyMeasurementCreateSchema = z.object({
  date: dateStringSchema,
  weightLbs: z.number().min(50).max(1000).optional(),
  waistIn: positiveFiniteCapped(120).optional(),
  neckIn: positiveFiniteCapped(60).optional(),
  hipsIn: positiveFiniteCapped(120).optional(),
  chestIn: positiveFiniteCapped(120).optional(),
  armIn: positiveFiniteCapped(60).optional(),
  thighIn: positiveFiniteCapped(60).optional(),
});

export type BodyMeasurementCreate = z.infer<typeof bodyMeasurementCreateSchema>;

// ---------------------------------------------------------------------------
// friendRequestCreate
// ---------------------------------------------------------------------------

export const friendRequestCreateSchema = z.object({
  friendId: z.string().uuid(),
});

export type FriendRequestCreate = z.infer<typeof friendRequestCreateSchema>;
