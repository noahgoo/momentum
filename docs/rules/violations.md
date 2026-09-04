# Known violations

Tracked debt, not accepted practice. Fix these when adjacent; do not add more.
Each row names the rule it breaks — see the file for that rule family in
`docs/rules/`.

When you fix one, delete its row.

| # | Where | Problem |
| --- | --- | --- |
| B9 | `packages/shared/src/schedule.ts:61` | **Scoped, not deleted.** The client app no longer resolves live data client-side — `get_workout_day`/`get_workout_week` do it in SQL. The helper survives for coach-web builder previews, where the program is unsaved and there is no server state to query, and is documented as builder-only. |
| B10 | `useRealtime.ts` (both apps) | Cross-side invalidation is ad hoc per mutation, with no shared contract (R6 risk). |

---

