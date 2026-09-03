# Momentum — agent instructions

Coach/client fitness app. pnpm workspace: `apps/coach-web` (React + Vite),
`apps/mobile` (Expo), `packages/shared`, Supabase Postgres with RLS.

Coaches author content once and many clients consume it, so almost every data
bug in this app is the same bug: **a write meant for one client reached
another, or a write meant for today rewrote the past.** The rules in
`docs/rules/` exist to make both impossible by construction.

---

## The tier model

Every row belongs to exactly one tier. The tier determines who may write it
and what a write is allowed to affect. This is the core model — everything in
`docs/rules/` elaborates on it.

| Tier | Tables | Identified by | Write rule |
| --- | --- | --- | --- |
| **Template** | `programs`, `workouts`, `workout_exercises`, `program_phases`, `week_schedules`, `exercises` | `client_id IS NULL` | Freely editable by the authoring coach. **Must never affect a client who is already assigned.** |
| **Instance** | the same tables | `client_id = <a client>` | Editable by that client's coach. Affects exactly one client. |
| **Event** | `workout_logs`, `exercise_logs`, `set_logs`, `goal_logs`, `body_measurements`, `progress_photos`, `messages` | always client-owned | Append and correct only. Never rewritten by a coach action, never cascade-deleted. |

Assigning a program **deep-copies** the template tree into `client_id`-stamped
instance rows. Editing a template never touches an assigned client; editing an
instance touches exactly one. Logs snapshot what they need so history never
changes underneath a client.

---

## Which rules to read

**Read the file before writing the code, not after.** Match on what you are
touching:

| If you are touching… | Read first |
| --- | --- |
| `supabase/migrations/`, any `queries/` hook, a mutation, RLS policies, deletes | [`docs/rules/data-model.md`](docs/rules/data-model.md) |
| the workout logger, workout history, `set_configs`, `set_logs`, reps/weights/durations | [`docs/rules/workout-numbers.md`](docs/rules/workout-numbers.md) |
| anything dated, any cron job, timezones, `client_summaries`, optimistic updates, a row two people can edit | [`docs/rules/concurrency.md`](docs/rules/concurrency.md) |
| a form, the query client, `staleTime`, offline behavior, a screen's load path | [`docs/rules/offline-perf.md`](docs/rules/offline-perf.md) |
| notifications, `notification_outbox`, push tokens, `workout_logs` from more than one hook | [`docs/rules/notifications.md`](docs/rules/notifications.md) |
| a file listed in [`docs/rules/violations.md`](docs/rules/violations.md) | that row's rule, before editing around it |

If more than one row matches, read all of them. If none obviously matches but
you are writing data code, read `data-model.md`.

`docs/rules/violations.md` tracks ~30 known breaches with `file:line`. Current
code is **not** a reliable example to copy — check that file before treating
an existing pattern as the norm. When you fix one, delete its row.

---

## Checklist for any data change

- [ ] Which tier does each touched row belong to? Does the write respect that tier's rule?
- [ ] Could this write, made for one client, change what a different client sees?
- [ ] Could this write change what a past date's history displays?
- [ ] Does it touch more than one row? If so, is it one transaction (an RPC)?
- [ ] Does it delete? What depends on the row, and is the error a domain message?
- [ ] Does it duplicate schedule resolution instead of calling the SQL function?
- [ ] Are both coach-side and client-side query keys invalidated?
- [ ] New table → RLS enabled, policies written, in the same migration.
- [ ] Does any displayed historical value get joined live instead of snapshotted?

For anything touching reps, weights, durations or distances:

- [ ] Is each number a prescription or a performance? Is it stored in the right place?
- [ ] Does a historical view read a target from a live workout row? (P1)
- [ ] Does any input pre-fill from a target? (P2)
- [ ] Is a set or exercise matched by array index anywhere? (P3)
- [ ] Does rendering trust the live mode instead of the logged one? (P4)
- [ ] Can a real `0` be swallowed into `—`, or an absent value shown as `0`? (P5)
- [ ] Does `weight_unit` travel with every weight, including into snapshots? (P6)

For anything dated, derived, or writable by both sides:

- [ ] Does any date come from a device clock instead of the client's timezone? (C1)
- [ ] Is a client's data rendered in the *coach's* timezone anywhere? (C1)
- [ ] Does a recurring job assume its own run time is meaningful for every client? (C1)
- [ ] Does a time picker offer granularity finer than the scheduler can deliver? (C1a)
- [ ] Is a derived value written by more than one writer, or missing a trigger on one of its inputs? (C2)
- [ ] Can two people write this row at once? Is last-write-wins actually acceptable here? (C3)
- [ ] Is the write safe to apply twice? Is a constraint violation translated to a domain message? (C4)
- [ ] Does a state transition re-check its precondition server-side, inside the transaction? (C5)
- [ ] Does an action trust user-submitted context that may be stale? (C5)
- [ ] Optimistic update → does it cancel, snapshot, and restore the snapshot on error? (C6)
- [ ] Does this degrade gracefully when the person on the other side is disabled? (C7)
- [ ] Can the user tell who set this value and when? (C8)

For anything a user types, or any new screen:

- [ ] Can entered data be lost by exiting, backgrounding, or a crash? (S1)
- [ ] Does the client have to think about saving, or remember to? (S2)
- [ ] Does this work with no connectivity? Does it error where it should queue? (S3)
- [ ] Is `staleTime`/`gcTime` chosen for this query, or silently inherited? (S4)
- [ ] Does a return visit paint from cache, or show a spinner over known data? (S5)
- [ ] How many sequential round trips before first meaningful paint? (S6)
- [ ] Any awaited query that didn't need to wait for the one before it? (S6)

For notifications and shared rows:

- [ ] Does this producer have a working consumer? (N1)
- [ ] Are permanent send failures distinguished from transient ones, and dead tokens cleared? (N2)
- [ ] Is the condition re-checked at send time, not just queue time? (N3)
- [ ] Does more than one hook create the same row? (W1)
- [ ] Does an upsert payload rely on defaults for columns another writer owns? (W1)
- [ ] Does completing one thing silently clear another? (W2)

A checklist item you cannot answer is a signal to open the rule file for it,
not to guess.

---

## Conventions

- Package manager: pnpm. Ask before adding a dependency.
- Commit messages: no scope prefix; explain *why* only when non-obvious from the diff.
- Migrations are append-only and numbered (`NNNN_description.sql`). Never edit an applied migration.
- Tables and policies carry `comment on` documentation — follow the existing density.
