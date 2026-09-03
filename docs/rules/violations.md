# Known violations

Tracked debt, not accepted practice. Fix these when adjacent; do not add more.
Each row names the rule it breaks — see the file for that rule family in
`docs/rules/`.

When you fix one, delete its row.

| # | Where | Problem |
| --- | --- | --- |
| B1 | `coach-web/src/queries/useAssign.ts:97` | Assign links the template id instead of deep-copying (breaks R1). |
| B2 | `usePrograms.ts:343`, `useWorkoutDetail.ts:136` | Editing a template rewrites every assigned client's live program (breaks tier 1). |
| B3 | `usePrograms.ts:361-370`, `useWorkoutDetail.ts:150` | Delete-and-reinsert churns phase/schedule/exercise ids (breaks R3). |
| B4 | `usePrograms.ts:61`, `useWorkouts.ts:58` | Hard delete with no dependent check; FKs lack explicit `on delete` (breaks R4). |
| B5 | `useWorkoutHistory.ts:41-46` | History joins live `workouts`/`workout_exercises` for targets (breaks tier 3, R8). |
| B6 | `0011_schedule_and_streak.sql` | `resolve_scheduled_workout` reads only the active assignment, so past dates re-resolve after a reassign (breaks R5). |
| B7 | `useSaveWorkoutLog.ts:78-129` | Non-transactional delete-then-reinsert of a log tree; can destroy a completed workout (breaks R2, tier 3). |
| B8 | `useAssign.ts:85-106` | Deactivate-then-insert is not atomic; a window exists with no active assignment (breaks R2). |
| B9 | `packages/shared/src/schedule.ts:61` | Client mirror of SQL resolution, already diverging on null `weeks` (R5 risk). |
| B10 | `useRealtime.ts` (both apps) | Cross-side invalidation is ad hoc per mutation, with no shared contract (R6 risk). |
| P-1 | `useWorkoutHistory.ts:41-46`, `history.tsx:115`, `RecentWorkouts.tsx`, `useClientDetail.ts:148` | Targets are re-read live from `workout_exercises.set_configs` instead of snapshotted. Editing a workout retroactively rewrites what past logs claim the client was asked to do; deleting an exercise blanks its targets permanently (breaks P1). `RecentWorkouts.tsx:33-36` documents this as "best-effort". |
| P-2 | `WorkoutLogger.tsx:58` | `weight: existingSet?.weight ?? cfg.weight` pre-fills the actual-weight input from the coach's target, and `handleSave` writes the draft to `set_logs.weight`. A client who taps ✓ without typing records the target as their actual — target and actual become indistinguishable in the data (breaks P2). |
| P-3 | `WorkoutLogger.tsx:180`, `history.tsx:115`, `WarmupCard.tsx:74` | Targets paired to sets by array index (`configs[setIdx]`, `configs[set.set_number - 1]`) and exercises by list position (`exercises[exIdx]`). Any insert, delete or reorder in the workout silently misattributes every downstream number (breaks P3). Compounded by B3's delete-and-reinsert. |
| P-4 | `useWorkoutDay.ts:114-119` | `previousLog` matches on `.eq("workout_id", workoutId)`, so the "LAST" column empties after a reassign changes which workout row a client is on (breaks P1's intent; compounded by B6). |
| C-1 | `useTodayWorkout.ts:65`, `useWorkoutWeek.ts:48`, `dashboard.tsx:75`, `goals.tsx:29,60`, `friends.tsx:24`, `messages.tsx:33` | "Today" comes from `dateStr(new Date())` — the device clock — while SQL uses `client_today()` (profile timezone). The two disagree while travelling before the sync lands, and disagree by definition anywhere coach-web renders a client's day. Writes keyed on the device date land on the wrong `workout_logs.date` / `goal_logs.date` (breaks C1). |
| C-2 | `0014_outbox_and_cron.sql:132` | `run_daily_maintenance` is scheduled `0 9 * * *` — 9am UTC, one fixed moment. Streaks and "today's workout" in `client_summaries` roll over at that instant regardless of client timezone, so a coach's dashboard shows yesterday's state for part of every day (breaks C1, C2). The hourly reminder job at `:139` handles this correctly and is the model to follow. |
| C-3 | `usePrograms.ts:330-400`, `useWorkoutDetail.ts:120-170` | Builders read a whole tree, hold it through a long edit, then write it all back with no `updated_at` check. Two coaches editing one program silently lose one of the edits (breaks C3). |
| C-4 | `0014_outbox_and_cron.sql:80,137` | Reminders compare only the *hour* (`extract(hour from notification_time)`) while the picker (`NotificationsCard.tsx:70`) offers minutes and the cron runs at `:05`. A client who sets 7:50 is reminded at 7:05 — 45 minutes early. The stored minute is silently discarded (breaks C1a). Fix: cron `*/15`, match to the quarter hour, picker snaps to :00/:15/:30/:45. |
| C-5 | `0014_outbox_and_cron.sql:104` | `last_reminder_date` is stamped with the client's local date, so a client travelling *west* past their notification hour can be reminded twice on the same local date. Rare, low harm (breaks C1a's at-most-once guarantee). |
| S-1 | `WorkoutLogger.tsx:98` | Logger draft state is component `useState` with no persistence and no exit guard. Navigating away, OS reclaim, or a crash destroys every set entered since the last manual "Save progress" tap. The app's most damaging bug (breaks S1, S2). |
| S-2 | `apps/mobile/lib/queryClient.ts` | No cache persistence and no `onlineManager`/NetInfo wiring. A cold start with no signal shows spinners and errors instead of last-known data, and offline mutations fail rather than queueing — in a gym, the app's primary environment (breaks S3). |
| S-3 | `apps/mobile/lib/queryClient.ts:6` | Every query inherits `staleTime: 30_000`; no query sets its own. The exercise library refetches as often as a live message thread (breaks S4). |
| S-4 | `useWorkoutDay.ts:57-140` | Four-level fetch waterfall on the hottest screen: assignment context → log → (workout ‖ exercises ‖ previousLog) → (warmup ‖ warmupExercises). The warmup pair does not depend on the middle batch but waits for it anyway (breaks S6). |
| N-1 | `0014_outbox_and_cron.sql:102` | **No outbox consumer exists.** `run_hourly_reminders` inserts rows that nothing ever reads; `sent_at` is never stamped and no push is ever sent. The settings UI offers reminders that cannot arrive. There is also no push-token column on `profiles`, so a consumer would have no destination (breaks N1). |
| N-2 | — | No retry/backoff, attempt tracking, dead-token handling, or pruning of sent rows — all unbuilt alongside the consumer (breaks N2). |
| M-1 | `useSendMessage.ts:38-67` | Send is three sequential writes (create thread → insert message → update thread) with no transaction. A failure after the message insert leaves the message stored but the thread's `last_message`/`unread_for_coach` unset — the coach never sees it (breaks R2). |
| M-2 | `useMarkMessagesRead.ts:12,44` | `READ_MARK_LIMIT = 100`, but `unread_for_client` is set false unconditionally. A client with more than 100 unread messages clears the badge while leaving the remainder `read = false` permanently — flag and rows disagree forever (breaks C2's "derived value must match its inputs"). |
| M-3 | `useSendMessage.ts:85` | The optimistic message's `sent_at` is device `new Date()` while the real row uses the server default, so a skewed device clock briefly renders messages out of order (breaks C1). |
| W-1 | `useWarmupToggle.ts:23-32` | Full-row upsert on `(client_id, date)` — the same conflict key `useSaveWorkoutLog` upserts with a different column set. Two creators for one row (breaks W1). It also creates a `workout_logs` row without checking the date has a scheduled workout, so a rest day can get a stub log. |
| W-2 | `WarmupCard.tsx:74` | Warm-up prescriptions read `set_configs` live, so a coach editing a warm-up retroactively changes what past logs show (breaks P1, same as P-1). |

---

