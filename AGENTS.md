# Momentum — agent instructions

Coach/client fitness app. pnpm workspace: `apps/coach-web` (React + Vite),
`apps/mobile` (Expo), `packages/shared`, Supabase Postgres with RLS.

Everything below the "Data rules" heading is binding on any change that reads
or writes application data. Read it before touching `supabase/migrations/`,
any `queries/` directory, or `packages/shared/src/schedule.ts`.

---

# Data rules

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

# Prescription vs. performance

This is R8 applied to the numbers clients actually see, and it is where the
app's most-reported bugs live. Reps, target weight, actual weight, durations
and distances are all governed by the rules in this section.

## Two kinds of number

Every number on a workout screen is exactly one of these. They are different
data with different owners, different lifetimes, and different storage.

| | **Prescription** (target) | **Performance** (actual) |
| --- | --- | --- |
| Answers | "What was I asked to do?" | "What did I do?" |
| Written by | coach, when authoring a workout | client, when logging |
| Lives in | `workout_exercises.set_configs` | `set_logs.reps/weight/actual_seconds/actual_miles` |
| Tier | template or instance | event |
| Changes when | the coach edits the workout | never, once logged |

The bug pattern this section exists to prevent: **reading a prescription live
when the reader needs the prescription as it stood at log time.** A target
displayed next to a past performance is a historical fact, not current
content, and must be stored as one.

## P1. A log snapshots its own prescription

When a client saves a log, the prescription in force at that moment is copied
into the log rows. History then renders from the log alone.

```
exercise_logs
  exercise_name  text     -- already snapshotted
  mode           enum     -- already snapshotted
  prescribed     jsonb    -- the exercise's SetConfig[] as of log time

set_logs
  set_number     int      -- display order within the exercise
  prescribed     jsonb    -- this set's target: {reps, weight, weight_unit,
                          --   seconds, miles, pace_seconds}
  reps           int      -- actual, client-entered
  weight         numeric  -- actual, client-entered
  actual_seconds int
  actual_miles   numeric
```

A history or past-date view must not join `workout_exercises` to fill in a
target column. If a target renders, it comes from `set_logs.prescribed`.

The live logger is the one legitimate exception: for a workout not yet logged,
reading `set_configs` live is correct, because the current prescription *is*
what the client is being asked to do today. The snapshot happens on first save.

## P2. Target never pre-fills actual

An empty actual field means the client has not entered a number. It must not
be seeded from the target.

Pre-filling makes the two indistinguishable in storage: a client who taps the
checkbox without typing produces a `set_logs.weight` identical to one who
genuinely lifted that weight. Coaches read those numbers to decide whether to
progress a client, so the distinction is the whole point of collecting them.

Show the target as adjacent read-only text (a TARGET column, placeholder, or
ghost value). Leave the input empty. Where "same as target" needs to be one
tap, make it an explicit action that records intent — a `weight_entered`
boolean, or a distinct value — never a silent default.

## P3. Sets and exercises are matched by identity, not position

Never pair a logged set with a target by array index, and never pair a logged
exercise with its workout row by position in a list.

Array position is not identity. A coach inserting a set, deleting one,
reordering exercises, or re-saving a workout at all (R3 — the current builder
deletes and reinserts) silently reassigns every downstream pairing. The
failure is silent: numbers still render, they are just attached to the wrong
thing.

Match on a stable key. Once P1 lands, the pairing problem mostly disappears —
a set's target travels on the set's own row, so there is nothing to match.
Until then, treat any `configs[i]` / `exercises[idx]` lookup as a bug.

## P4. Mode is read from the log, never from the live workout

`exercise_logs.mode` decides how a logged exercise renders. A coach switching
an exercise from `reps` to `time` reshapes what `set_configs` contains; a
history view trusting the live mode will read `{seconds}` where it expects
`{reps}` and render nothing.

The already-snapshotted `mode` is correct — keep it, and make sure the
prescription read alongside it comes from the same snapshot.

## P5. Absent and zero are different

`—` means no value was recorded. `0` means zero reps, zero weight, a skipped
set the client explicitly marked. Bodyweight exercises legitimately carry no
weight and must not display as `0`, and a genuine `0` must not be swallowed
into `—`.

Nullish-coalesce (`??`), never `||`, when a real `0` is possible. The existing
`parseSetConfig` drops non-finite values rather than coercing them; new
parsing follows that shape. `formatDuration`/`formatMiles`/`formatPace`
already return `—` only for nullish or non-finite input — match that.

## P6. Units travel with the number

A weight is meaningless without `weight_unit`. It is stored per set
(`set_logs.weight_unit`, `SetConfig.weightUnit`) and must be carried through
every copy, snapshot and display — including into `prescribed`.

Never assume lbs. Never compare or aggregate two weights without checking
their units match first.

---

# Concurrent editing and shared state

Coaches and clients edit the same records at the same time, from two apps, on
two devices. These rules cover what happens when they disagree, when a value
is derived from other values, and when "today" means different things to
different people.

## C1. "Today" is the client's today, everywhere

### The model

A workout belongs to a **calendar day**, not a moment. There is no time of day
attached to it — a client who trains at 6am and one who trains at 11pm both
logged "Tuesday". So every date in this app is a local calendar date in the
**client's** timezone, and the client's timezone is whatever their device
reports.

`profiles.timezone` holds it, device-synced on sign-in and every app
foreground (`apps/mobile/lib/timezone.ts`), with no manual picker anywhere.
SQL resolves through `client_today(client_id)`. That function *is* the
definition of "today" for a client; nothing else is.

### Rules

**Application code resolves dates the same way SQL does.** Not from the device
clock, and never from the coach's clock. `dateStr(new Date())` gives the
*device's* today, which is a different thing:

- On the client's own phone it usually agrees — but diverges in the window
  after crossing a timezone, before the foreground sync lands. A workout
  logged in that window writes to a date the server disagrees with.
- On coach-web it is simply wrong. `new Date()` there is the coach's date.

Anything keyed by date — `workout_logs.date`, `goal_logs.date`, streaks, "is
today done" — resolves against the client's timezone or it silently writes to
the wrong day.

**A client's data renders in the client's timezone, on both apps.** A coach in
New York opening a Los Angeles client at 1am Tuesday sees that client's
Monday, still open, because that is what the client sees. The coach's own
timezone is used only for coach-owned UI — the coach's clock, their own
notification settings — never for interpreting a client's day.

Where the difference could confuse, label it rather than hide it: "Mon · client's
time". A coach with clients in several timezones is better served by rows that
each say which day they mean than by a single dashboard date that is wrong for
most of them.

**Never mark something missed that is not yet over.** The coach's day rolling
over does not end the client's. A workout is missed when the *client's* day
ends, not the viewer's.

### Recurring jobs

A single cron time is a single moment, not the same local hour everywhere. A
job that means "once per client per local day" must compute per client:

```sql
-- correct: each client's own local wall clock
v_local_today := (now() at time zone coalesce(v_client.timezone, 'America/New_York'))::date;
v_local_hour  := extract(hour from (now() at time zone coalesce(...)))::int;
```

`run_hourly_reminders` does this correctly and is the model. A job scheduled
at one UTC hour that assumes its run time is meaningful for everyone (as
`run_daily_maintenance` currently does) is wrong for every client outside that
offset — see violation C-2.

DST is handled correctly by `now() at time zone tz` and must stay that way: a
client's 7:00 reminder stays at 7:00 wall clock across a DST shift rather than
drifting an hour. This is intentional. Do not "fix" it into a fixed UTC offset.

## C1a. Reminders fire at the client's chosen local time

`notification_time` is a wall-clock time in the client's own timezone. What
the client sets is what they get.

The scheduler's resolution and the picker's granularity must match. Reminders
run every 15 minutes and match to the quarter hour; the settings picker offers
only :00/:15/:30/:45. Offering a granularity the scheduler cannot hit means
silently discarding what the client chose — the current hour-only comparison
fires a 7:50 reminder at 7:05 (violation C-4).

If the cron interval changes, the picker changes with it, in the same commit.

Reminders are also **at-most-once per client per local day**, guarded by
`profiles.last_reminder_date` compared against the client's local date. Any
new recurring notification carries the same guard.

## C2. Derived data is derived in one place, and is never authoritative

`client_summaries` is a rollup: streak, today's workout, goal counts, unread
flags. It is written only by `refresh_client_summary()`, trigger- and
cron-driven, never by application code. Keep it that way — the moment two
writers maintain a cache, they disagree.

Rules for any derived value:

- **One writer.** A SQL function or trigger owns it. Application code reads it
  and never writes it.
- **A read path that doesn't need it.** Derived data is an optimization. If it
  is stale or missing, the app must still be able to compute the truth. Never
  make a rollup the only place a fact exists.
- **Every input has a trigger.** If a value feeds the rollup, writes to it
  refresh the rollup. A missing trigger is a permanently-wrong dashboard.
- **Time-dependent values need a scheduled refresh.** A value that changes
  because the date rolled over (streaks, "today's workout") goes stale with no
  write to trigger it — see C1 for why one daily cron time is not enough.

## C3. Last-write-wins is a decision, not a default

Two coaches, or a coach and a client, can edit the same row concurrently. A
bare `.update()` silently discards whichever write lost the race, with no
indication to either person.

For each mutable record, decide and write down which applies:

- **Last-write-wins** — fine for single-owner fields (a coach's own draft, a
  client's own profile). Most fields.
- **Conflict detection** — compare `updated_at` against what the editor loaded
  and surface a real message ("this program changed while you were editing").
  Warranted where two people plausibly edit at once and losing work matters:
  the program and workout builders.
- **Merge by field** — where edits to different fields shouldn't clobber each
  other. Update only changed fields rather than writing the whole row back.

The builders currently read a whole tree, let a coach edit for minutes, then
write the whole tree back. That is the highest-risk shape in the app for
silent loss, and it is worth conflict detection when touched.

## C4. Idempotent writes over guarded writes

A user will double-tap. A network will retry. A write that is safe to apply
twice needs no guard.

`useToggleGoalLog` is the exemplar: upsert with `ignoreDuplicates` for on,
delete-by-key for off. Both are no-ops the second time. Prefer that shape —
upsert on a natural key, delete by key — over check-then-write, which has a
race between the check and the write.

Where a unique constraint is the guard, catch the violation and translate it
into a domain message rather than surfacing a Postgres code.
`useCreateChangeRequest` does this correctly (23505 →
`DuplicatePendingRequestError`).

## C5. State transitions are atomic and re-runnable

A request that is accepted, a program that is assigned, a message that is read
— each is a transition with side effects, and each can be triggered twice by
an impatient tap.

Do the transition in one SQL function that re-checks the precondition inside
the transaction. A second call finds the precondition already false and
returns a clean domain error rather than double-applying.

`accept_change_request` is the exemplar: it re-resolves the schedule
server-side, applies the swap, and stamps the status atomically; a second
call cleanly raises `not_found_or_forbidden`. Note what it does *not* do —
trust the `workout_id` the client sent. That was a snapshot from when the
request was filed and may be stale by the time the coach acts; the RPC
re-resolves live. **Any action taken on stale user-submitted context
re-validates server-side.**

## C6. Optimistic updates snapshot and roll back

Optimistic UI follows the three-part shape in `useToggleGoalLog`: `onMutate`
cancels in-flight queries, snapshots the cache, and applies the change;
`onError` restores the exact snapshot; `onSettled` invalidates to reconcile.

Never "undo" an optimistic change by re-deriving the prior state — the
snapshot is the only trustworthy record of it. Never skip the
`cancelQueries`, or an in-flight response can land on top of the optimistic
value and flip the UI back.

Optimistic updates suit small, single-row toggles. A multi-row tree write
(a workout log) reconciles on settle instead and shows explicit saving state.

## C7. Deleting a person is a soft delete

Clients and coaches leave. Their messages, logs and history are referenced by
people who remain, and by the other side of a relationship.

`profiles.disabled` already models this — nothing hard-deletes a profile. Any
new relationship (friendships, threads) must degrade gracefully when one side
is disabled: show "Former client", not a blank name or a crash. A coach's view
of a departed client's history must keep working.

## C8. Show whose value it is, and when it changed

This is the UX half of every rule above. Data that is correct but unattributed
still confuses people.

Where a coach and a client can both write, the UI says which one did:
`goals.set_by` and `locked` distinguish a coach's goal from a client's;
`goals.archived_by` records who archived it. Preserve that when adding new
shared-write records — an `_by` column and a timestamp, surfaced in the UI.

Where a value can be stale — a rollup, a cached summary, a snapshot taken at
request time — the UI shows when it was computed rather than implying it is
live.

---

# Persistence, offline, and performance

Clients use this app in gyms — basements, concrete, dead zones. Bad
connectivity is the normal case, not the edge case. A client mid-workout has
already done the work; losing their record of it is the worst failure this app
can produce, worse than any wrong number, because they cannot reconstruct it
from memory.

These rules govern when data is written, what survives a crash, and how fast
a screen appears.

## S1. In-progress work is never lost

Any form a user can spend more than a few seconds filling in autosaves its
draft to device storage. Exiting, backgrounding, crashing, or being reclaimed
by the OS must never destroy entered data.

This applies most to the workout logger, and also to message composition,
program/workout builders, and measurement entry.

- Draft state persists locally on change, keyed by what it belongs to
  (client + date + workout).
- Returning to the screen restores the draft and says so ("Restored your
  unsaved progress") rather than silently resurrecting values.
- A draft is cleared only once its content is durably saved to the server.
- Component `useState` alone is not persistence. Unpersisted local state is
  acceptable only for genuinely transient UI — an open modal, a toggled
  accordion.

## S2. The workout logger saves as the client works

The client is holding weights, sweating, mid-set. They should never have to
think about saving, and never lose a set because they didn't.

| Action | Behavior |
| --- | --- |
| Typing in a field | Local draft only. No network. |
| Field blur | Local draft only. |
| Checking a set off | Debounced background save (~2s). |
| "Complete ✓" | Immediate write, finalizes the log. |

Checking a set off is the discrete, meaningful moment — it means "I did this"
— so it is what triggers a save. Typing does not, because partially-typed
values ("13" on the way to "135") should not reach the server.

Background saves are silent on success. They never block input, never show a
spinner over the form, and never steal focus. Failure is surfaced as a quiet,
persistent indicator ("Not saved — will retry"), never a modal or a toast that
interrupts a set.

## S3. Offline is a supported state, not an error

A client with no signal can open the app, see today's workout, log the entire
session, and have it sync when they reconnect. The app never blocks logging on
connectivity.

Required pieces:

- **The query cache persists to AsyncStorage**, so a cold start with no
  network still renders the last-known workout, program, and goals rather than
  a spinner or an error.
- **`onlineManager` is wired to NetInfo.** Without it React Query does not
  know the device is offline and fires requests that fail instead of pausing.
- **Mutations queue and replay on reconnect.** A queued mutation survives an
  app restart. Replay is ordered, and idempotent per C4 so a replayed write is
  safe.
- **Offline state is visible and calm.** A persistent, unobtrusive indicator
  ("Offline — changes will sync"), and on reconnect a resolution ("All changes
  saved"). Never an error dialog for an expected condition.

Cached data displayed offline is labeled as of when it was fetched wherever
staleness could mislead — per C8.

**Writes that must not queue offline** are those whose meaning depends on
current server state: accepting a change request, assigning a program. These
require connectivity and say so plainly. Client-owned logging never does.

## S4. Cache lifetimes are chosen per query, not inherited

The global default (`staleTime: 30s`) is a starting point, not a decision.
Each query sets a lifetime matching how fast its data actually changes and how
bad it is to show a stale value.

Rough tiers:

- **Static / rarely changing** (exercise library, a workout's definition):
  long `staleTime`, minutes. Cheap to cache, jarring to refetch constantly.
- **Client-owned and self-modified** (today's workout, goals, logs): short —
  the user's own writes update it optimistically anyway.
- **Live and shared** (messages, unread counts, coach dashboard summaries):
  realtime-driven. The subscription is what keeps them fresh; `staleTime`
  mainly controls refetch on focus.

`gcTime` outlives `staleTime` — a screen the user returns to should paint from
cache instantly, then revalidate. Persisted queries need a `gcTime` long
enough to be worth persisting.

## S5. Screens paint from cache first, then revalidate

Never show a blank screen or a full-screen spinner for data that has been
loaded before. Render the cached value immediately, refresh in the background,
and update in place.

- **First-ever load** (no cache): a skeleton matching the real layout, not a
  spinner. No layout shift when data arrives.
- **Return visit**: cached content immediately, with a subtle refreshing
  indicator if the refetch is slow.
- **Refetch after mutation**: no visible loading state at all — the optimistic
  value already reflects the change.

Pull-to-refresh is available on every list and detail screen, and is the only
place a client should see an explicit loading spinner for already-cached data.

## S6. Load-time budgets

Targets for the client app on typical gym LTE (~200ms RTT), measured from
navigation to meaningful content:

| Screen | Cold (no cache) | Warm (cached) |
| --- | --- | --- |
| Today's workout | < 1.5s | < 200ms |
| Workout day / logger | < 1.5s | < 200ms |
| Dashboard | < 2s | < 300ms |
| History, lists | < 2s | < 300ms |

Warm targets assume S3's persisted cache: a returning client sees content
essentially instantly, before any network call resolves.

The rules that keep these met:

- **Round trips are the cost, not payload size.** Sequential dependent
  fetches are what make a screen slow. Batch with joins, or run independent
  fetches in `Promise.all` — never await one query only to start another that
  didn't depend on it.
- **A screen's data is one query hook** where practical, composing its fetches
  internally, rather than several hooks each triggering their own waterfall.
- **Never N+1.** Collect ids and use one `.in()` — `useWorkoutHistory` does
  this correctly.
- **Fetch what the screen renders.** `select("*")` on a table with wide or
  rarely-used columns is waste on a slow link.

`useWorkoutDay` is the current worst case and the one to measure against: it
awaits the assignment context, then a batch of three, then a further batch of
two for the warmup — a four-level waterfall on the app's hottest screen.

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

## Known violations

Tracked debt, not accepted practice. Fix these when adjacent; do not add more.

| # | Where | Problem |
| --- | --- | --- |
| B1 | `coach-web/src/queries/useAssign.ts:97` | Assign links the template id instead of deep-copying (breaks R1). |
| B2 | `usePrograms.ts:343`, `useWorkoutDetail.ts:136` | Editing a template rewrites every assigned client's live program (breaks tier 1). |
| B3 | `usePrograms.ts:361-370`, `useWorkoutDetail.ts:150` | Delete-and-reinsert churns phase/schedule/exercise ids (breaks R3). |
| B4 | `usePrograms.ts:61`, `useWorkouts.ts:58` | Hard delete with no dependent check; FKs lack explicit `on delete` (breaks R4). |
| B5 | `useWorkoutHistory.ts:41-46` | History joins live `workouts`/`workout_exercises` for targets (breaks tier 3, R8). |
| B6 | `0011_schedule_and_streak.sql` | `resolve_scheduled_workout` reads only the active assignment, so past dates re-resolve after a reassign (breaks R5). |
| B7 | `useSaveWorkoutLog.ts:78-129` | Non-transactional delete-then-reinsert of a log tree; can destroy a completed workout (breaks R2, tier 3). |
| B8 | `useAssign.ts:85-106` | Deactivate-then-insert is not atomic; a window exists with no active assignment (breaks R2). |
| B9 | `packages/shared/src/schedule.ts:61` | Client mirror of SQL resolution, already diverging on null `weeks` (R5 risk). |
| B10 | `useRealtime.ts` (both apps) | Cross-side invalidation is ad hoc per mutation, with no shared contract (R6 risk). |
| P-1 | `useWorkoutHistory.ts:41-46`, `history.tsx:115`, `RecentWorkouts.tsx`, `useClientDetail.ts:148` | Targets are re-read live from `workout_exercises.set_configs` instead of snapshotted. Editing a workout retroactively rewrites what past logs claim the client was asked to do; deleting an exercise blanks its targets permanently (breaks P1). `RecentWorkouts.tsx:33-36` documents this as "best-effort". |
| P-2 | `WorkoutLogger.tsx:58` | `weight: existingSet?.weight ?? cfg.weight` pre-fills the actual-weight input from the coach's target, and `handleSave` writes the draft to `set_logs.weight`. A client who taps ✓ without typing records the target as their actual — target and actual become indistinguishable in the data (breaks P2). |
| P-3 | `WorkoutLogger.tsx:180`, `history.tsx:115`, `WarmupCard.tsx:74` | Targets paired to sets by array index (`configs[setIdx]`, `configs[set.set_number - 1]`) and exercises by list position (`exercises[exIdx]`). Any insert, delete or reorder in the workout silently misattributes every downstream number (breaks P3). Compounded by B3's delete-and-reinsert. |
| P-4 | `useWorkoutDay.ts:114-119` | `previousLog` matches on `.eq("workout_id", workoutId)`, so the "LAST" column empties after a reassign changes which workout row a client is on (breaks P1's intent; compounded by B6). |
| C-1 | `useTodayWorkout.ts:65`, `useWorkoutWeek.ts:48`, `dashboard.tsx:75`, `goals.tsx:29,60`, `friends.tsx:24`, `messages.tsx:33` | "Today" comes from `dateStr(new Date())` — the device clock — while SQL uses `client_today()` (profile timezone). The two disagree while travelling before the sync lands, and disagree by definition anywhere coach-web renders a client's day. Writes keyed on the device date land on the wrong `workout_logs.date` / `goal_logs.date` (breaks C1). |
| C-2 | `0014_outbox_and_cron.sql:132` | `run_daily_maintenance` is scheduled `0 9 * * *` — 9am UTC, one fixed moment. Streaks and "today's workout" in `client_summaries` roll over at that instant regardless of client timezone, so a coach's dashboard shows yesterday's state for part of every day (breaks C1, C2). The hourly reminder job at `:139` handles this correctly and is the model to follow. |
| C-3 | `usePrograms.ts:330-400`, `useWorkoutDetail.ts:120-170` | Builders read a whole tree, hold it through a long edit, then write it all back with no `updated_at` check. Two coaches editing one program silently lose one of the edits (breaks C3). |
| C-4 | `0014_outbox_and_cron.sql:80,137` | Reminders compare only the *hour* (`extract(hour from notification_time)`) while the picker (`NotificationsCard.tsx:70`) offers minutes and the cron runs at `:05`. A client who sets 7:50 is reminded at 7:05 — 45 minutes early. The stored minute is silently discarded (breaks C1a). Fix: cron `*/15`, match to the quarter hour, picker snaps to :00/:15/:30/:45. |
| C-5 | `0014_outbox_and_cron.sql:104` | `last_reminder_date` is stamped with the client's local date, so a client travelling *west* past their notification hour can be reminded twice on the same local date. Rare, low harm (breaks C1a's at-most-once guarantee). |
| S-1 | `WorkoutLogger.tsx:98` | Logger draft state is component `useState` with no persistence and no exit guard. Navigating away, OS reclaim, or a crash destroys every set entered since the last manual "Save progress" tap. The app's most damaging bug (breaks S1, S2). |
| S-2 | `apps/mobile/lib/queryClient.ts` | No cache persistence and no `onlineManager`/NetInfo wiring. A cold start with no signal shows spinners and errors instead of last-known data, and offline mutations fail rather than queueing — in a gym, the app's primary environment (breaks S3). |
| S-3 | `apps/mobile/lib/queryClient.ts:6` | Every query inherits `staleTime: 30_000`; no query sets its own. The exercise library refetches as often as a live message thread (breaks S4). |
| S-4 | `useWorkoutDay.ts:57-140` | Four-level fetch waterfall on the hottest screen: assignment context → log → (workout ‖ exercises ‖ previousLog) → (warmup ‖ warmupExercises). The warmup pair does not depend on the middle batch but waits for it anyway (breaks S6). |

---

# Conventions

- Package manager: pnpm. Ask before adding a dependency.
- Commit messages: no scope prefix; explain *why* only when non-obvious from the diff.
- Migrations are append-only and numbered (`NNNN_description.sql`). Never edit an applied migration.
- Tables and policies carry `comment on` documentation — follow the existing density.
