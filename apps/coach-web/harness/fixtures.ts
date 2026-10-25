import type { QueryClient } from "@tanstack/react-query";
import type { ClientSummary, Exercise, Program, Thread, Workout } from "@momentum/shared";
import { qk } from "../src/queries/keys";
import type { WorkoutDetail } from "../src/queries/useWorkoutDetail";
import type { ProgramDetail } from "../src/queries/usePrograms";
import type { ChangeRequestRow, ChangeRequestsData } from "../src/queries/useChangeRequests";
import type { SessionDetail } from "../src/queries/useSessionDetail";
import type { ClientProgram } from "../src/queries/useClientProgram";
import type { ThreadWithClient } from "../src/queries/useThreads";
import { HARNESS_COACH_ID } from "./stub-auth";

/**
 * The data every harness run starts from.
 *
 * Everything here is typed against the same types the hooks return, so a
 * schema change or a reshaped hook breaks `pnpm typecheck` rather than quietly
 * rendering an empty screen that someone has to debug. That is worth the extra
 * ceremony: fixture drift has already cost two debugging sessions.
 *
 * Values are chosen to be awkward on purpose — a client name long enough to
 * overflow a phone, an email that will not fit, a client with no program — so
 * the layout checks have something to fail on.
 */

export const CLIENT_IDS = ["client-0", "client-1", "client-2", "client-3"] as const;
/** The workout the builder's edit-mode checks open. */
export const EDITABLE_WORKOUT_ID = "w-1";
/**
 * A client's own copy of a program, as `assign_program` leaves it: `client_id`
 * set, and its schedule pointing at client-stamped workout copies that are
 * absent from the coach's library list (`useWorkouts` filters `client_id IS
 * NULL`). Opening it in the library builder is the shape that loses a client's
 * schedule, so the regression check needs a fixture that is faithful about it.
 */
export const INSTANCE_PROGRAM_ID = "p-instance";
/**
 * A phased client instance — its scheduled days live under `phases[].sessionSlots`,
 * not `flatSessionSlots`. The day-list view has to read both shapes (see R9's
 * client-instance branch in ProgramBuilderPage) or a phased client sees no days
 * to edit at all.
 */
export const PHASED_INSTANCE_PROGRAM_ID = "p-instance-phased";
/** A workout stamped with CLIENT_IDS[0] — deliberately NOT in `workouts`. */
export const INSTANCE_WORKOUT_ID = "w-instance-1";
/** `updated_at` on that workout; the staleness checks plant drafts either side of it. */
export const EDITABLE_WORKOUT_UPDATED_AT = "2026-09-01T10:00:00Z";
/** How long after mount the workout detail lands. See the note in `seed`. */
export const DETAIL_DELIVERY_MS = 120;

const clientSummaries = [
  {
    client_id: CLIENT_IDS[0],
    display_name: "Marguerite Okonkwo-Bergstrom",
    email: "marguerite.okonkwo.bergstrom@example.com",
    streak: 42,
    has_program: true,
    today_workout_name: "Lower Body Hypertrophy — Week 6",
    today_completed: false,
    disabled: false,
    unread_for_coach: true,
    last_message_at: "2026-09-09T14:03:00Z",
    last_workout_at: "2026-09-08",
  },
  {
    client_id: CLIENT_IDS[1],
    display_name: "Sam Reyes",
    email: "sam@example.com",
    streak: 3,
    has_program: true,
    today_workout_name: null,
    today_completed: true,
    disabled: false,
    unread_for_coach: false,
    last_message_at: null,
    last_workout_at: "2026-09-10",
  },
  {
    client_id: CLIENT_IDS[2],
    display_name: "Priyanka Venkataraman",
    email: "priyanka.venkataraman@longdomainname.example",
    streak: 17,
    has_program: true,
    today_workout_name: "Upper Body Push A",
    today_completed: false,
    disabled: false,
    unread_for_coach: false,
    last_message_at: null,
    last_workout_at: "2026-09-09",
  },
  {
    client_id: CLIENT_IDS[3],
    display_name: "Jo Lin",
    email: "jo@example.com",
    streak: 0,
    has_program: false,
    today_workout_name: null,
    today_completed: false,
    disabled: true,
    unread_for_coach: false,
    last_message_at: null,
    last_workout_at: null,
  },
] as unknown as ClientSummary[];

const exercises = [
  { id: "e-1", name: "Barbell Bench Press", category: "chest", default_mode: "reps" },
  {
    id: "e-2",
    name: "Bulgarian Split Squat (Rear-Foot-Elevated)",
    category: "legs",
    default_mode: "reps",
  },
  { id: "e-3", name: "Plank", category: "core", default_mode: "time" },
  { id: "e-4", name: "Treadmill Intervals", category: "cardio", default_mode: "distance" },
].map(
  (ex) =>
    ({
      ...ex,
      coach_id: HARNESS_COACH_ID,
      client_id: null,
      default_sets: 3,
      default_reps: 10,
      default_duration_seconds: 45,
      default_distance: 1,
      default_distance_unit: "mi",
      default_load_type: null,
      video_url: null,
    }) as unknown as Exercise
);

const workouts = [
  {
    id: EDITABLE_WORKOUT_ID,
    name: "Upper Body Push A",
    description: "Bench focus, long rests",
    estimated_duration_minutes: 55,
    category: "strength",
  },
  {
    id: "w-2",
    name: "Conditioning — Intervals & Accessory Circuit",
    description: null,
    estimated_duration_minutes: 30,
    category: "conditioning",
  },
].map(
  (w) =>
    ({
      ...w,
      type: "workout",
      coach_id: HARNESS_COACH_ID,
      client_id: null,
      equipment: ["dumbbells", "bench"],
      warmup_id: null,
    }) as unknown as Workout
);

const workoutDetail: WorkoutDetail = {
  id: EDITABLE_WORKOUT_ID,
  name: "Upper Body Push A",
  description: "Bench focus, long rests",
  type: "workout",
  estimatedDurationMinutes: 55,
  category: "strength",
  equipment: ["dumbbells", "bench"],
  warmupId: null,
  updatedAt: EDITABLE_WORKOUT_UPDATED_AT,
  exercises: [
    {
      id: "we-1",
      exerciseId: "e-1",
      mode: "reps",
      setConfigs: [{ reps: 8, weight: 135, weightUnit: "lbs" }],
      restSeconds: 90,
      notes: null,
    },
  ],
};

const programs = [
  { id: "p-1", name: "12-Week Strength Base", description: "Phased", weeks: 12 },
  { id: "p-2", name: "Summer Cut", description: null, weeks: 8 },
].map(
  (p) =>
    ({
      ...p,
      coach_id: HARNESS_COACH_ID,
      client_id: null,
      phased: p.id === "p-1",
    }) as unknown as Program
);

/**
 * The client's own copy, the row `ClientHeaderCard`'s "Edit program" link
 * opens. Its one scheduled day points at INSTANCE_WORKOUT_ID, which the
 * builder's picker cannot see.
 */
const instanceProgramDetail: ProgramDetail = {
  id: INSTANCE_PROGRAM_ID,
  name: "12-Week Strength Base",
  description: "Marguerite's copy",
  weeks: 12,
  clientId: CLIENT_IDS[0],
  phased: false,
  phases: [],
  flatActiveDays: ["monday"],
  flatWeekSchedule: { "1": { monday: INSTANCE_WORKOUT_ID } },
  flatSessionSlots: { "1": { monday: { id: "s-instance-1", sourceChanged: false } } },
  updatedAt: "2026-09-01T10:00:00Z",
};

/** A phased client instance — see PHASED_INSTANCE_PROGRAM_ID. */
const phasedInstanceProgramDetail: ProgramDetail = {
  id: PHASED_INSTANCE_PROGRAM_ID,
  name: "Base to Peak",
  description: "Marguerite's copy",
  weeks: 8,
  clientId: CLIENT_IDS[0],
  phased: true,
  phases: [
    {
      id: "ph-1",
      name: "Base",
      weeks: 4,
      activeDays: ["monday"],
      weekSchedule: { "1": { monday: INSTANCE_WORKOUT_ID } },
      sessionSlots: { "1": { monday: { id: "s-instance-phased-1", sourceChanged: false } } },
    },
  ],
  flatActiveDays: [],
  flatWeekSchedule: {},
  flatSessionSlots: {},
  updatedAt: "2026-09-01T10:00:00Z",
};

/**
 * The same two copies as ClientProgramEditor reads them: days by session id.
 * The flat one also has a day with no library source (a migrated/blank day),
 * which the old library-shaped view could not show at all.
 */
const instanceClientProgram: ClientProgram = {
  id: INSTANCE_PROGRAM_ID,
  name: "12-Week Strength Base",
  description: "Marguerite's copy",
  clientId: CLIENT_IDS[0],
  // A Wednesday: week 1 runs Wed Oct 21 .. Tue Oct 27, so Monday falls on Oct 26.
  startDate: "2026-10-21",
  weeks: 2,
  phased: false,
  phases: [],
  days: [
    { sessionId: "s-instance-1", phaseId: null, week: 1, day: "monday", name: "Upper Body Push A" },
    { sessionId: "s-instance-2", phaseId: null, week: 1, day: "wednesday", name: "Imported Legs" },
  ],
  updatedAt: "2026-09-01T10:00:00Z",
};

const phasedInstanceClientProgram: ClientProgram = {
  id: PHASED_INSTANCE_PROGRAM_ID,
  name: "Base to Peak",
  description: "Marguerite's copy",
  clientId: CLIENT_IDS[0],
  startDate: "2026-10-21",
  weeks: 2,
  phased: true,
  phases: [{ id: "ph-1", name: "Base", weeks: 2 }],
  days: [{ sessionId: "s-instance-phased-1", phaseId: "ph-1", week: 1, day: "monday", name: "Upper Body Push A" }],
  updatedAt: "2026-09-01T10:00:00Z",
};

/** One scheduled day, for the session editor route. */
const sessionDetail: SessionDetail = {
  id: "s-1",
  name: "Upper Body Push A",
  description: "Bench focus, long rests",
  estimatedDurationMinutes: 55,
  warmupName: "Shoulder prep",
  sourceWorkoutId: EDITABLE_WORKOUT_ID,
  clientId: CLIENT_IDS[0],
  programId: "p-1",
  updatedAt: "2026-09-01T10:00:00Z",
  exercises: [
    {
      id: "se-warm-1",
      section: "warmup",
      exerciseId: "e-3",
      mode: "time",
      setConfigs: [{ seconds: 45 }],
      restSeconds: 30,
      notes: null,
    },
    {
      id: "se-main-1",
      section: "main",
      exerciseId: "e-1",
      mode: "reps",
      setConfigs: [{ reps: 8, weight: 135, weightUnit: "lbs" }],
      restSeconds: 90,
      notes: null,
    },
  ],
};

const threads = CLIENT_IDS.slice(0, 3).map(
  (clientId, i) =>
    ({
      id: `t-${i}`,
      client_id: clientId,
      coach_id: HARNESS_COACH_ID,
      client_display_name: clientSummaries[i]!.display_name,
      last_message:
        "Quick question about the squat cue you mentioned on Tuesday — should I be bracing before or after the unrack?",
      last_message_at: "2026-09-09T14:03:00Z",
      unread_for_coach: i === 0,
    }) as unknown as ThreadWithClient
);

const threadMessages = [
  { id: "m-1", sender_id: CLIENT_IDS[0], body: "Morning! Finished the session." },
  { id: "m-2", sender_id: HARNESS_COACH_ID, body: "Nice work. How did that last set feel?" },
  {
    id: "m-3",
    sender_id: CLIENT_IDS[0],
    body: "Quick question about the squat cue you mentioned on Tuesday — should I be bracing before or after the unrack?",
  },
].map(
  (m, i) =>
    ({
      ...m,
      thread_id: "t-0",
      sent_at: `2026-09-09T1${i}:00:00Z`,
      read_at: null,
    }) as unknown as Thread
);

/** Seeds every query the harness routes read. Call before the first render. */
export function seed(qc: QueryClient) {
  qc.setQueryData(qk.clientSummaries(), clientSummaries);

  qc.setQueryData(qk.exercises(), exercises);
  qc.setQueryData(
    qk.exerciseUsageCounts(exercises.map((e) => e.id)),
    Object.fromEntries(exercises.map((e, i) => [e.id, i + 1]))
  );

  qc.setQueryData(qk.workouts(), workouts);
  qc.setQueryData(qk.warmups(), []);
  qc.setQueryData(
    qk.workoutExerciseCounts(workouts.map((w) => w.id)),
    Object.fromEntries(workouts.map((w) => [w.id, 3]))
  );
  // Deliberately NOT seeded synchronously. A builder reached by navigation has
  // no cached detail on its first render — `useWorkoutDetail` has no
  // `initialData` — and anything that reads `detail?.updatedAt` during that
  // render sees `undefined`. Handing it over before the first paint hid a real
  // bug: the draft staleness check read `null` in production and restored every
  // draft, while the harness test passed. Deliver it the way the app does.
  // A 0ms timeout is not enough: React's initial render is itself scheduled, so
  // the callback can land before the first paint and hand `detail` over after
  // all. This has to be unambiguously later than the first render.
  setTimeout(() => {
    qc.setQueryData(qk.workoutDetail(EDITABLE_WORKOUT_ID), workoutDetail);
  }, DETAIL_DELIVERY_MS);

  qc.setQueryData(qk.programs(), programs);
  // Seeded synchronously, unlike workoutDetail: this check is about what the
  // picker can resolve, not about hydration timing.
  qc.setQueryData(qk.programDetail(INSTANCE_PROGRAM_ID), instanceProgramDetail);
  qc.setQueryData(qk.programDetail(PHASED_INSTANCE_PROGRAM_ID), phasedInstanceProgramDetail);
  qc.setQueryData(qk.clientProgram(INSTANCE_PROGRAM_ID), instanceClientProgram);
  qc.setQueryData(qk.clientProgram(PHASED_INSTANCE_PROGRAM_ID), phasedInstanceClientProgram);
  // The client program editor's picker lists the library plus this client's shelf.
  qc.setQueryData(qk.workouts(CLIENT_IDS[0]), workouts);
  qc.setQueryData(qk.sessionDetail("s-1"), sessionDetail);
  // The session's client prefers kg / km, to check new rows start in them.
  qc.setQueryData(qk.clientUnits(CLIENT_IDS[0]), { weightUnit: "kg", distanceUnit: "km" });

  qc.setQueryData(qk.threads(), threads);
  // useThreadMessages is a plain useQuery over a flat, oldest-first array.
  qc.setQueryData(qk.threadMessages("t-0"), threadMessages);

  qc.setQueryData(qk.changeRequests(), changeRequests);
}

/** One move, with the fields the hook attaches for display. */
function move(
  id: string,
  batchId: string,
  position: number,
  clientIdx: number,
  from: string,
  to: string,
  workoutName: string,
  overrides: Partial<ChangeRequestRow> = {}
): ChangeRequestRow {
  return {
    id,
    batch_id: batchId,
    position,
    client_id: CLIENT_IDS[clientIdx]!,
    coach_id: HARNESS_COACH_ID,
    from_date: from,
    to_date: to,
    session_id: null,
    session_name: workoutName,
    workoutName,
    clientName: clientSummaries[clientIdx]!.display_name,
    status: "pending",
    requested_at: "2026-10-20T09:00:00Z",
    responded_at: null,
    decided_by: null,
    auto_applied: false,
    skip_reason: null,
    ...overrides,
  };
}

/**
 * A three-workout batch from a client with a name long enough to overflow a
 * phone (two of them missed days), a single-workout request, and one row of
 * each decided state so history exercises every label.
 */
const changeRequests: ChangeRequestsData = {
  pending: [
    move("m-1", "b-1", 1, 0, "2026-10-12", "2026-10-26", "Upper Body Strength and Hypertrophy Block"),
    move("m-2", "b-1", 2, 0, "2026-10-14", "2026-10-27", "Lower Body Power"),
    move("m-3", "b-1", 3, 0, "2026-10-28", "2026-10-30", "Conditioning"),
    move("m-4", "b-2", 1, 1, "2026-10-26", "2026-10-27", "Push Day", { requested_at: "2026-10-21T09:00:00Z" }),
  ],
  history: [
    move("h-1", "b-3", 1, 2, "2026-10-05", "2026-10-06", "Push Day", {
      status: "accepted",
      responded_at: "2026-10-05T12:00:00Z",
    }),
    move("h-2", "b-4", 1, 3, "2026-10-05", "2026-10-07", "Pull Day", {
      status: "accepted",
      auto_applied: true,
      responded_at: "2026-10-05T12:00:00Z",
    }),
    move("h-3", "b-5", 1, 3, "2026-10-08", "2026-10-09", "Legs", {
      status: "skipped",
      skip_reason: "already_logged",
      responded_at: "2026-10-08T12:00:00Z",
    }),
    move("h-4", "b-6", 1, 2, "2026-10-09", "2026-10-10", "Core", {
      status: "cancelled",
      responded_at: "2026-10-09T12:00:00Z",
    }),
  ],
};
