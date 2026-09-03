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
| **Template** | `programs`, `workouts`, `workout_exercises`, `program_phases`, `week_schedules`, `exercises` | `client_id IS NULL` | Freely editable by the authoring coach. **Must never affect a client who is already assigned.** |
| **Instance** | the same tables | `client_id = <a client>` | Editable by that client's coach. Affects exactly one client. |
| **Event** | `workout_logs`, `exercise_logs`, `set_logs`, `goal_logs`, `body_measurements`, `progress_photos`, `messages` | always client-owned | Append and correct only. Never rewritten by a coach action, never cascade-deleted. |

`programs.client_id` and `workouts.client_id` already exist for this purpose.
A row with `client_id IS NULL` is library content; a row with `client_id` set
is one client's private copy. Nothing else distinguishes them.

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

### Tier 2 — Instances

Assigning a program **deep-copies** the whole tree. The client's program is
structurally independent from the day it is assigned.

```
programs (client_id = null)          ← template, coach's library
  ├─ program_phases
  ├─ week_schedules ──┐
  └─                  └→ workouts (client_id = null)
                           └─ workout_exercises

        ASSIGN  ↓  deep copy, one transaction

programs (client_id = alice)         ← instance, Alice's only
  ├─ program_phases (copies)
  ├─ week_schedules (copies, remapped)
  └─                  └→ workouts (client_id = alice, copies)
                           └─ workout_exercises (copies)

assignments.program_id → Alice's copy, never the template
```

The copy is deep to the leaves: program, phases, week_schedules, the workouts
those schedules reference, those workouts' exercise rows, and any linked
warmup workout. `exercises` (the shared exercise library — name, video,
defaults) is **not** copied; it is reference data, and instance
`workout_exercises` keep FKing into it.

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
- **`restrict`** where a delete would strand a client — `assignments.program_id`,
  `week_schedules.workout_id`.
- **`set null`** for provenance pointers that history keeps but does not
  depend on — `workout_logs.workout_id`, `exercise_logs.exercise_id`.

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

---

