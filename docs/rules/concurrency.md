# Concurrency, timezones, and shared state

What happens when a coach and client edit at once, when a value is derived
from other values, and when "today" means different things to different
people. Read this before touching anything dated, derived, or writable by
both sides.

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

