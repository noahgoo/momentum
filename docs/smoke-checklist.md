# E2E Smoke Checklist

Seeded accounts: `coach1@momentum.test` / `client1@momentum.test` (Ava) … `password123`.
Automated checks already verified against the live DB are marked ✅; manual items are ☐.

## Verified live (orchestrated run, 2026-09-01)

- ✅ GoTrue password login for coach + client roles
- ✅ RLS isolation: coach1 sees 7 summaries, coach2 sees 3; client sees only own rows; anon fully denied
- ✅ Streak pipeline: log → trigger → client_summaries (Ava 21 w/ grace, Cara 3 broken, Hana 4)
- ✅ Change-request accept RPC: atomic swap (from→rest, to→workout), double-accept clean error
- ✅ SQL assertion suite (`supabase/tests/wave3_assertions.sql` → `WAVE3_ASSERTIONS PASSED`)
- ✅ `list_coach_siblings` RPC (excludes self + disabled)
- ✅ `pnpm typecheck && pnpm test && pnpm lint` + coach-web build all green

## Manual pass (run in Expo Go + browser)

- ☐ Mobile: coach login rejected with portal message; coach-web: client login rejected
- ☐ Mobile dashboard renders all widgets from seed (motivation, today card, goals, streak, friends)
- ☐ Log a full workout as client1 → coach dashboard card flips live (realtime, no refresh)
- ☐ Warmup checkbox alone survives navigation (stub log)
- ☐ Goal double-tap creates one log; swipe-archive keeps week-chart history
- ☐ Chat both directions live (mobile ↔ coach inbox); unread dot on mobile tab appears/clears
- ☐ Move-workout request from mobile → appears in coach Change Requests → accept → both days swapped in mobile week grid
- ☐ Photo upload (grid + coach detail strip see it); delete removes storage then row
- ☐ Measurement w/ neck+waist shows Navy BF%; female profile without hips shows placeholder
- ☐ Builder round-trip: new workout w/ 3 exercises reordered → assign program → client sees correct day
- ☐ Friends: send request via Find friends → other client accepts (requester's Accept blocked)
- ☐ Timezone: change simulator tz → relaunch → profile timezone updates, "today" shifts

## Remediation paths (device-only — not covered by tests or CI)

These behave correctly by construction and by SQL assertion, but the parts
that need real hardware or a real network have never been observed running.
Check each before shipping.

### Offline (S-1, S-2, S-3)

- ☐ Mid-workout data survives a crash: enter several sets, force-quit from the app
      switcher, reopen the same day → values restored with "Restored your unsaved
      progress"
- ☐ Autosave without tapping anything: check a set off, wait ~3s, kill the app,
      reopen → that set is still complete (there is no longer a "Save progress"
      button to fall back on)
- ☐ Airplane mode, cold start: force-quit, enable airplane mode, launch → today's
      workout renders from cache rather than a spinner or an error
- ☐ Log a full session in airplane mode → "Offline — your changes will sync"
      shows; re-enable network → "Syncing…" then "All changes saved", and the log
      is on the server exactly once (not duplicated)
- ☐ **Queued write survives a restart**: log offline, force-quit *while still
      offline*, reopen, then reconnect → the log still syncs. This is the path
      that silently drops a workout if a mutation key has no registered default
- ☐ Offline the coach cannot reach: sending a change request while offline fails
      with a message rather than queueing

### Push notifications (N-1, N-2, C-4)

- ☐ Grant the OS prompt on first launch → a `push_tokens` row appears for that device
- ☐ Set a reminder to the next quarter hour → push arrives within that slot (NOT at
      :05 past the hour — that was the bug), and `notification_outbox.sent_at` is stamped
- ☐ Complete the workout before the slot → no reminder arrives (re-checked at send time)
- ☐ Deny the OS prompt but leave reminders on in-app → settings explains notifications
      are blocked, with a working link to system Settings
- ☐ Sign out → the device's `push_tokens` row is gone
- ☐ Uninstall the app, let a reminder fire → the dead token is deleted rather than
      retried (check `push_tokens` and `notification_outbox.attempts`)
- ☐ Second device on the same account → both receive the reminder

### Cross-timezone (C-1, C-2)

- ☐ Coach in one timezone, client several hours behind: the coach's client detail and
      heatmap show the *client's* day, and a workout is not shown missed while the
      client still has hours left in it
