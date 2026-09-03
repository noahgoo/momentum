# Known violations

Tracked debt, not accepted practice. Fix these when adjacent; do not add more.
Each row names the rule it breaks — see the file for that rule family in
`docs/rules/`.

When you fix one, delete its row.

| # | Where | Problem |
| --- | --- | --- |
| B3 | `usePrograms.ts` (`useSaveProgram`) | **Half fixed.** `save_workout` now reconciles workout_exercises by natural key, and the program builder no longer risks cross-client damage (B1/B2 closed). `useSaveProgram` still deletes and reinserts phases/week_schedules, churning their ids on every save. Needs a `save_program` RPC of the same shape. |
| B6 | `0011_schedule_and_streak.sql` | `resolve_scheduled_workout` reads only the active assignment, so past dates re-resolve after a reassign (breaks R5). |
| B9 | `packages/shared/src/schedule.ts:61` | Client mirror of SQL resolution, already diverging on null `weeks` (R5 risk). |
| B10 | `useRealtime.ts` (both apps) | Cross-side invalidation is ad hoc per mutation, with no shared contract (R6 risk). |
| C-2 | `0014_outbox_and_cron.sql:132` | `run_daily_maintenance` is scheduled `0 9 * * *` — 9am UTC, one fixed moment. Streaks and "today's workout" in `client_summaries` roll over at that instant regardless of client timezone, so a coach's dashboard shows yesterday's state for part of every day (breaks C1, C2). The hourly reminder job at `:139` handles this correctly and is the model to follow. |
| C-3 | `usePrograms.ts:330-400` | **Half fixed.** The workout builder now sends the `updated_at` it loaded and a competing save raises `stale_write`. The program builder does not yet — it lands with `save_program`. |
| C-4 | `0014_outbox_and_cron.sql:80,137` | Reminders compare only the *hour* (`extract(hour from notification_time)`) while the picker (`NotificationsCard.tsx:70`) offers minutes and the cron runs at `:05`. A client who sets 7:50 is reminded at 7:05 — 45 minutes early. The stored minute is silently discarded (breaks C1a). Fix: cron `*/15`, match to the quarter hour, picker snaps to :00/:15/:30/:45. |
| C-5 | `0014_outbox_and_cron.sql:104` | `last_reminder_date` is stamped with the client's local date, so a client travelling *west* past their notification hour can be reminded twice on the same local date. Rare, low harm (breaks C1a's at-most-once guarantee). |
| S-2 | `apps/mobile/lib/queryClient.ts` | No cache persistence and no `onlineManager`/NetInfo wiring. A cold start with no signal shows spinners and errors instead of last-known data, and offline mutations fail rather than queueing — in a gym, the app's primary environment (breaks S3). |
| S-3 | `apps/mobile/lib/queryClient.ts:6` | Every query inherits `staleTime: 30_000`; no query sets its own. The exercise library refetches as often as a live message thread (breaks S4). |
| S-4 | `useWorkoutDay.ts:57-140` | Four-level fetch waterfall on the hottest screen: assignment context → log → (workout ‖ exercises ‖ previousLog) → (warmup ‖ warmupExercises). The warmup pair does not depend on the middle batch but waits for it anyway (breaks S6). |
| N-1 | `0014_outbox_and_cron.sql:102` | **No outbox consumer exists.** `run_hourly_reminders` inserts rows that nothing ever reads; `sent_at` is never stamped and no push is ever sent. The settings UI offers reminders that cannot arrive. There is also no push-token column on `profiles`, so a consumer would have no destination (breaks N1). |
| N-2 | — | No retry/backoff, attempt tracking, dead-token handling, or pruning of sent rows — all unbuilt alongside the consumer (breaks N2). |
| M-2 | `useMarkMessagesRead.ts:12,44` | `READ_MARK_LIMIT = 100`, but `unread_for_client` is set false unconditionally. A client with more than 100 unread messages clears the badge while leaving the remainder `read = false` permanently — flag and rows disagree forever (breaks C2's "derived value must match its inputs"). |

---

