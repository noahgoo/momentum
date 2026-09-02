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
