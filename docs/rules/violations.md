# Known violations

Tracked debt, not accepted practice. Fix these when adjacent; do not add more.
Each row names the rule it breaks — see the file for that rule family in
`docs/rules/`.

When you fix one, delete its row.

| # | Where | Problem |
| --- | --- | --- |
| B9 | `packages/shared/src/schedule.ts:61` | **Scoped, not deleted.** The client app no longer resolves live data client-side — `get_workout_day`/`get_workout_week` do it in SQL. The helper survives for coach-web builder previews, where the program is unsaved and there is no server state to query, and is documented as builder-only. |
| B10 | `useRealtime.ts` (both apps) | Cross-side invalidation is ad hoc per mutation, with no shared contract (R6 risk). |
| B11 | coach-web: `BroadcastPage`, `MessageThread`, `ExerciseCreateModal`, `ExercisesPage`/`ExerciseLibraryPanel` inline edit, `MotivationPage`, `MotivationOverridePanel`. mobile: `app/(tabs)/messages.tsx` composer | **Known, scoped.** Multi-field forms and composers still hold entry in `useState` alone, so a reload or a backgrounded app loses it (S1). The long forms are done — both coach builders and mobile measurement entry use the draft hooks (`apps/coach-web/src/lib/useDraft.ts`, `apps/mobile/lib/useDraft.ts`). Use those when fixing one of these; do not copy the bare `useState` next to them. |
| B12 | `apps/coach-web/src/App.tsx:23` | Bare `new QueryClient()`: no cache persister, no `onlineManager`, no mutation defaults. The coach portal has no offline story at all, unlike mobile's `lib/queryClient.ts`. Closing this needs a decision per write about which may safely queue — `assign_program` must not (S3). |
| B13 | `apps/mobile/lib/auth.tsx:101` | Sign-out clears the session and the push token but not local storage. The persisted query cache (`lib/queryClient.ts`) and any workout or measurement draft survive, so the previous user's workouts, messages and measurements stay readable on the device. Coach-web clears its drafts on sign-out (`src/lib/useDraft.ts` `clearDrafts`); mobile's equivalent is larger because the whole cache is persisted, and needs `persister.removeClient()` plus draft cleanup. |

---

