# Data model rules

The tier model and the eight rules for any code that reads or writes data.
Read this before touching `supabase/migrations/`, any `queries/` directory, or
a mutation hook. See `AGENTS.md` for the checklist and `violations.md` for
tracked debt.

Coaches author content once and many clients consume it, so almost every data
bug in this app is the same bug: a write meant for one client reached another,
or a write meant for today rewrote the past. These rules exist to make both
impossible by construction rather than by remembering to be careful.

## The three tiers

Every row in this database belongs to exactly one tier. The tier determines
who may write it, and what a write is allowed to affect.

| Tier | Tables | Identified by | Write rule |
| --- | --- | --- | --- |
| **Library** | `exercises`, `workouts`, `workout_exercises` | `client_id IS NULL` = global, set = one client's shelf | Freely editable by the authoring coach. A library row **never has a live dependent** — every scheduled day is a copy — so there is nothing to protect. |
| **Schedule** | `programs`, `program_phases`, `sessions`, `session_exercises` | `programs.client_id IS NULL` = template, set = one client's assigned copy | Editable by the authoring coach. A template edit reaches nobody already assigned; an instance edit reaches exactly one client, on exactly one day. |
| **Event** | `workout_logs`, `exercise_logs`, `set_logs`, `goal_logs`, `body_measurements`, `progress_photos`, `messages` | always client-owned | Append and correct only. Never rewritten by a coach action, never cascade-deleted. |

A row's TABLE says which tier it is in. `workouts` used to carry three jobs
at once — the thing a coach picks from, the thing a program schedules, and the
thing a client does — distinguished only by `client_id`, so every query had to
remember to filter on it. Splitting the schedule out into `sessions` gave
`client_id` one meaning again: on a library row it says whose shelf the entry
sits on, and nothing more.

### Tier 1 — Templates

A template is a blueprint. Editing it changes what *future* assignments will
produce, and nothing else.

- Library list queries filter `client_id IS NULL` (see `usePrograms.ts`).
  Every new library query must do the same, or per-client copies leak into the
  coach's library UI.
- A template is never referenced by `assignments.program_id`. If you find code
  assigning a template id directly, that is the bug — fix it, don't work
  around it.
- Deleting a template is safe by definition, because no live client depends on
  one. If a delete fails on a foreign key, something violated this rule.

### Tier 2 — Schedules

Assigning a program **deep-copies** the whole tree. The client's program is
structurally independent from the day it is assigned.

```
workouts (client_id = null)          ← library, what a coach picks from
  └─ workout_exercises
        ⇡ source_workout_id (provenance only; never read for display)

programs (client_id = null)          ← template
  ├─ program_phases
  └─ sessions                        ← one row per week × day, a COPY
       └─ session_exercises            section = warmup | main

        ASSIGN  ↓  deep copy, one transaction

programs (client_id = alice)         ← Alice's only
  ├─ program_phases (copies)
  └─ sessions (copies)
       └─ session_exercises (copies)

assignments.program_id → Alice's copy, never the template
```

The copy is deep to the leaves: program, phases, sessions and their exercise
rows. It writes **no `workouts` rows at all** — sessions already are the
per-client copy, which is what makes "workouts is library-only" true by
construction rather than by discipline. `exercises` (the shared exercise
library — name, video, defaults) is not copied either; it is reference data,
and `session_exercises` keep FKing into it.

A session is a copy, never a pointer, so editing week 3 edits week 3 and
nothing else. That is the property the whole split exists for: under the old
`week_schedules`, every week that scheduled the same workout shared one row,
so a coach could not vary week 5 without varying week 3, and editing any week
rewrote the rest — including past ones.

Consequences to hold onto:

- Editing one client's Tuesday workout touches one client. There is no
  copy-on-write check to remember, because the fork already happened.
- "Push a template update to everyone" is an explicit re-assign, not a side
  effect of saving the template. If a coach wants that, they re-assign.
- Instance rows are garbage only when no assignment references them. Never
  bulk-delete by `client_id`.

### Tier 3 — Events

A log records what happened. It is the client's record, and a coach action
must never destroy or silently reinterpret it.

- **Logs snapshot what they need.** `exercise_logs` already stores
  `exercise_name` and `mode` at log time rather than joining live. Extend that
  to the prescription: a `prescribed` jsonb carrying the target sets, reps,
  weight and durations as they stood when the client logged.
- **History renders from logs alone.** A history or past-date view must not
  join `workouts` or `workout_exercises` to fill in targets. If a screen needs
  a value to render history, that value belongs in the log row.
- **Never cascade a coach action into logs.** `workout_logs.workout_id` is a
  provenance pointer, not a dependency. Deleting or editing a workout must
  leave every log intact and still readable.

## Rules for writing data code

### R1. Assign copies; it never links

`assignments.program_id` points at an instance (`client_id` set), always.
Assignment happens through the `assign_program` RPC, which deep-copies,
deactivates the prior assignment, and inserts the new one in one transaction.
Client code calls the RPC; it does not sequence the steps itself.

### R2. Multi-row writes go in one transaction

If a logical operation touches more than one row, it is a SQL function called
over RPC — not a sequence of `supabase.from(...)` calls. Supabase's JS client
gives you no transaction, so a chain of awaits has a failure mode where half
the operation lands.

This applies to: assigning a program, saving a workout log tree, saving a
program's phases and schedules, deactivate-then-insert pairs, and any
delete-then-reinsert.

The current `useSaveWorkoutLog` is the anti-pattern to recognize: it deletes a
log's children, then inserts replacements over several round trips. A dropped
connection between them leaves the client's completed workout destroyed with
nothing to roll back to.

### R3. Prefer upsert-and-diff over delete-and-reinsert

Replace-wholesale is convenient and wrong twice over. It churns primary keys,
so anything holding an id goes stale and realtime subscribers see delete/insert
storms instead of updates. And it opens the window R2 describes.

Reconcile by natural key instead — `(workout_id, sort_order)`,
`(program_id, week_number, day_of_week)`, `(exercise_log_id, set_number)` —
so unchanged rows keep their ids. When a full replace is genuinely simpler,
it happens inside one SQL function so the window is closed.

### R4. Destructive operations check dependents first, and report in domain terms

Before deleting, count what depends on the row and surface it: "3 clients are
currently assigned to this program", not a raw foreign-key error code. Where
history could be lost, soft-delete instead — `goals` already models this with
`archived_at`/`archived_by`; follow it.

Foreign keys carry an explicit `on delete` clause, chosen deliberately:

- **`cascade`** only within an aggregate the parent fully owns — a workout's
  exercise rows, a log's set rows.
- **`restrict`** where a delete would strand a client — `assignments.program_id`.
- **`set null`** for provenance pointers that history keeps but does not
  depend on — `workout_logs.session_id`, `exercise_logs.exercise_id`,
  `sessions.source_workout_id`, `workouts.source_workout_id`.

A bare `references` with no clause means `NO ACTION`, which fails late and
opaquely. Don't leave it implicit.

### R5. Schedule resolution has one authoritative implementation

`resolve_scheduled_workout` in SQL is the source of truth for what a client is
scheduled to do on a date. `packages/shared/src/schedule.ts` is a preview
mirror for optimistic UI only.

The mirror must not be the basis for a write, and any change to resolution
logic changes both, in the same commit, with a shared test case. When they
disagree, SQL wins and the mirror is the bug.

Resolution for a **past** date resolves against the assignment that was active
on that date, not the currently active one. Reassigning a client must not
change what their history says they were asked to do.

### R6. A write reaches every viewer of that data

Coach and client see the same rows and must see the same values. Every
mutation lists the query keys it invalidates on both sides, and rows that two
people watch live are in the realtime publication.

When adding a mutation, name the coach-side and client-side keys it affects
explicitly. `apps/mobile/lib/queries/useRealtime.ts` and its coach-web
counterpart are deliberate duplicates — a change to one is a change to both.

### R7. RLS is the security boundary; client filters are for correctness only

Policies already scope reads by `is_coach_of()` / `auth.uid()`, so a
client-side `.eq("coach_id", ...)` is redundant and should be omitted. A
client-side filter that carries *domain* meaning — `client_id IS NULL` to mean
"library only" — is required and must stay.

Every new table gets RLS enabled and policies in the same migration that
creates it. Every `security definer` function gets `set search_path = ''` and
an explicit `revoke execute ... from public, anon` before any targeted grant.

### R8. Snapshot anything a later reader must see unchanged

If a value is displayed as a historical fact, copy it into the historical row
rather than joining it live. Names, prescriptions, goal text, and message
bodies are facts about a moment. `exercise_logs.exercise_name`,
`goal_logs.goal_text` and `friendships.member_names` already follow this.

### R9. A library row is a copy source, never a live dependency

`workouts` and `sessions` are separate tables because a coach picking "Push
Day" for week 3 is making a copy, not a reference. `sessions.source_workout_id`
records where the copy came from and nothing more: it is `on delete set null`,
and `workout_usage_count` reports it as information rather than as a blocker.
Deleting a library entry leaves every scheduled day standing with its own
exercises intact.

The consequence is the point. Every `workouts` row is freely editable, global
or client-scoped alike, and `client_id` is free to mean one thing again —
whose shelf the entry sits on — because it no longer doubles as "has this been
forked yet". A library list reads `client_id is null or client_id = :client`;
a bare `client_id IS NULL` filter is now correct only on the global-only
library page.

Pushing a library edit into days already materialized from it is an explicit
`apply_session_to_future`, never a side effect of saving the workout. That RPC
is the exemplar: it skips any day the client has already reached, and any day
that already has a log, and returns counts so the UI says what it did instead
of claiming success.

### R10. Moving a scheduled day writes overrides, never sessions or logs

A client's request to move workouts — upcoming or missed — is a Schedule-tier
write: one `assignment_date_overrides` row per affected date, for one client.
It never edits a `sessions` row and never touches an Event row.

- Filing and applying both go through RPCs (`request_schedule_moves`,
  `decide_schedule_moves`); `change_requests` has no insert/update policies, so
  the checks cannot be skipped. One row is one move, `batch_id` groups a
  submission, and the coach decides any subset.
- A move is refused when either date has a `workout_logs` row, when the target
  is before the **client's** today (C1), or when it is not a rest day inside
  the same assignment. Targets must be rest days: a swap would put a workout on
  a date that has already passed.
- The source becomes an explicit rest override. That does change what a past
  date resolves to, so the accepted `change_requests` row keeps a
  `session_name` snapshot (R8) and the week view reads "Moved to <date>" from
  it. Do not treat a rest override on a past date as proof nothing was
  scheduled there.
- `profiles.move_approval` (`coach` | `auto`) is coach-set per client. `auto`
  applies at filing time and the row says so (`auto_applied`, C8).

---
