# Data-access hooks (mobile)

Pattern rules every feature slice (Wave 7+) must follow. Read `useTodayWorkout.ts`
and `useToggleGoalLog.ts` first — they're the exemplars.

## Query keys

- Every key comes from `qk` in `keys.ts`. Never inline a `["foo", id]` array in a
  hook — add a factory function to `keys.ts` instead.
- Keys are hierarchical for prefix invalidation: `qk.goalLogs(uid, date)` nests
  under `qk.goals(uid)`, so `invalidateQueries({ queryKey: qk.goals(uid) })`
  invalidates every date's logs too. Keep new keys nested the same way when
  they're conceptually "under" an existing resource.

## Row types

- Import row/insert types from `@momentum/shared` (`Profile`, `Workout`,
  `GoalLog`, etc.) — never redefine or hand-roll a table shape locally. If a
  type you need doesn't exist yet, add it to `packages/shared/src/domain.ts`,
  not here.
- Supabase queries are typed via the generated `Database` type (the client is
  already constructed with it in `lib/supabase.ts`) — every `.from(...)`
  call is typed automatically. Don't cast query results with `as`.

## Optimistic mutations

Shape (see `useToggleGoalLog.ts`):

1. `mutationFn` — the actual write.
2. `onMutate` — cancel in-flight queries for the affected key, snapshot the
   current cache value, write the optimistic value, return `{ previous, key }`.
3. `onError` — restore the snapshot from context. Never hand-derive a
   "reverse" of the optimistic change.
4. `onSettled` — always invalidate the affected key, regardless of success or
   failure, so the cache reconciles with the server.

Idempotent toggles (goal logs, and anything else with an
`upsert(... onConflict, ignoreDuplicates: true)` / matched-delete pair) should
treat a duplicate insert or missing delete target as success, not an error.

## Realtime

- Use `useRealtimeSubscription` from `useRealtime.ts` for any
  `postgres_changes` listener — don't call `supabase.channel(...)` directly
  in a screen or hook.
- Only `messages`, `threads`, `workout_logs`, `goal_logs`, and
  `client_summaries` are in the realtime publication. Subscribing to any
  other table silently receives nothing.
- RLS applies to realtime payloads the same as normal reads — a subscription
  only receives rows the connection could already SELECT. `filter` reduces
  traffic; it is not a security boundary.
- On change, either patch the react-query cache directly (fast path, see
  `useClientSummaries.ts` on the coach-web side for the pattern) or call
  `invalidateQueries` with the relevant `qk` key — don't build a second,
  parallel state store for realtime data.

## Invalidation conventions

- Mutations invalidate via `qk`, matching the query they affect.
- Prefer invalidating the narrowest key that's still correct (e.g.
  `qk.goalLogs(uid, date)` over `qk.goals(uid)`) unless the mutation could
  plausibly affect sibling dates/resources too.
