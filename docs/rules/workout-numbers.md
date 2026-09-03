# Workout numbers: prescription vs. performance

Reps, target weight, actual weight, durations and distances. Read this before
touching the workout logger, workout history, or anything reading
`set_configs` / `set_logs`.

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

