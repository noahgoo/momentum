import type { QueryClient } from "@tanstack/react-query";
import type { ClientSummary, Exercise, Program, Thread, Workout } from "@momentum/shared";
import { qk } from "../src/queries/keys";
import type { WorkoutDetail } from "../src/queries/useWorkoutDetail";
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
      default_miles: 1,
      video_url: null,
    }) as unknown as Exercise
);

const workouts = [
  {
    id: EDITABLE_WORKOUT_ID,
    name: "Upper Body Push A",
    description: "Bench focus, long rests",
    estimated_duration_minutes: 55,
  },
  {
    id: "w-2",
    name: "Conditioning — Intervals & Accessory Circuit",
    description: null,
    estimated_duration_minutes: 30,
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

  qc.setQueryData(qk.threads(), threads);
  // useThreadMessages is a plain useQuery over a flat, oldest-first array.
  qc.setQueryData(qk.threadMessages("t-0"), threadMessages);

  qc.setQueryData(qk.changeRequests(), { pending: [], history: [] });
}
