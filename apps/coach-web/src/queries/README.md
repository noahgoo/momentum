# Data-access hooks (coach-web)

Pattern rules every feature slice (Wave 9+) must follow. Read
`useClientSummaries.ts` first — it's the exemplar.

## Query keys

- Every key comes from `qk` in `keys.ts`. Never inline a `["foo", id]` array
  in a hook — add a factory function to `keys.ts` instead.
- Keys are hierarchical for prefix invalidation: `qk.clientDetail(id)` nests
  under `qk.clientSummaries()`. Keep new keys nested the same way when
  they're conceptually "under" an existing resource.

## Row types

- Import row/insert types from `@momentum/shared` (`ClientSummary`,
  `Thread`, `Workout`, `Program`, etc.) — never redefine or hand-roll a
  table shape locally. If a type you need doesn't exist yet, add it to
  `packages/shared/src/domain.ts`, not here.
- Supabase queries are typed via the generated `Database` type (the client
  is already constructed with it in `lib/supabase.ts`) — every `.from(...)`
  call is typed automatically. Don't cast query results with `as`.
- Never add a client-side `coach_id = auth.uid()` filter — RLS already
  scopes every coach-facing table to the signed-in coach's own clients/
  content. Adding a redundant filter would mask an RLS bug instead of
  surfacing it.

## Optimistic mutations

Same three-part shape as mobile (see `apps/mobile/lib/queries/README.md` for
the full writeup): `onMutate` snapshots + writes optimistic cache state,
`onError` restores the snapshot, `onSettled` invalidates.

## Realtime

- Use `useRealtimeSubscription` from `useRealtime.ts` for any
  `postgres_changes` listener — don't call `supabase.channel(...)` directly
  in a page or hook.
- Only `messages`, `threads`, `workout_logs`, `goal_logs`, and
  `client_summaries` are in the realtime publication. Subscribing to any
  other table silently receives nothing.
- RLS applies to realtime payloads the same as normal reads.
- **Live-dashboard pattern** (see `useClientSummaries.ts`): on a realtime
  event, patch the react-query cache directly — upsert-by-key for
  INSERT/UPDATE, remove-by-key for DELETE — instead of invalidating and
  refetching the whole list. This is the expected pattern for any
  frequently-changing coach list view (client summaries, threads inbox).

### Why `useRealtime.ts` is duplicated, not shared

`apps/mobile` and `apps/coach-web` each have their own copy of
`useRealtime.ts`. This is deliberate: `packages/shared` holds pure
domain logic and types only (no React, no app-layer hooks), and the two
apps otherwise don't share UI-layer code — mobile is React Native,
coach-web is web React, and a "shared hooks" package would need to abstract
over both runtimes for no real benefit given how small this wrapper is. If
the realtime pattern changes, update both copies by hand.

## Invalidation conventions

- Mutations invalidate via `qk`, matching the query they affect.
- Prefer invalidating the narrowest key that's still correct (e.g.
  `qk.clientDetail(id)` over `qk.clientSummaries()`) unless the mutation
  could plausibly affect the list view too (e.g. anything that changes
  `display_name`, `streak`, or another summary column).
