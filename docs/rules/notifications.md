# Notifications, delivery, and shared rows

The outbox contract, push delivery, and rules for rows written by more than
one feature. Read this before touching notifications, the outbox, or
`workout_logs`.

A notification is a promise made in a settings screen and kept hours later by
a background job. Both halves have to exist, and the client has to be able to
tell which state they are in.

## N1. Queue and send are separate, and both are required

Notifications go through `notification_outbox`: the producer (a cron function)
inserts a row, a consumer sends it and stamps `sent_at`. The table is
service-role only, with no RLS policies, and that stays true.

The split is deliberate — a failed send must not roll back the decision to
send, and a slow push provider must not block a cron transaction. But a
producer with no consumer is worse than no feature: rows accumulate, `sent_at`
stays NULL forever, and the settings UI promises reminders that never arrive.
That is the current state (violation N-1).

**Never ship a producer without its consumer**, and never leave a settings
toggle enabled for a delivery path that does not work end to end.

## N2. Delivery is retried, bounded, and cleaned up

A consumer must handle the states a push provider actually returns:

- **Transient failure** (network, provider 5xx): retry with exponential
  backoff, bounded by an attempt count. Track attempts on the row.
- **Permanent failure** (invalid or unregistered token — the app was
  uninstalled): stop retrying and clear the dead token from the profile.
  Retrying a dead token forever is the classic outbox leak.
- **Success**: stamp `sent_at` in the same operation that records the send.

Sent rows are pruned on a schedule. An outbox that only grows is a slow
outage.

Push tokens live on the profile, are refreshed on app launch, and are cleared
on sign-out and on permanent send failure. A token is per device — a client
with two devices has two, and delivery targets all of them.

## N3. A notification is still correct when it arrives

A reminder is queued at one moment and delivered later. Between those, the
client may have completed the workout, the coach may have moved it, or the
program may have been reassigned.

Re-check the condition at send time, not only at queue time. `run_hourly_reminders`
correctly checks "scheduled and not completed" before queueing; the consumer
should not send a stale reminder for a workout finished in the interim.

Notification payloads carry ids, not rendered text, wherever the underlying
data can change before delivery. Deep links resolve live when opened.

## N4. Notification state is visible and reversible

`notifications_enabled` and `notification_time` are the client's, and the app
never sends what they turned off. OS-level permission is separate from the
in-app preference: a client who granted neither, or revoked at the OS level,
sees why they are not receiving reminders rather than silence.

Per C1a, reminders fire at the client's chosen local time, at most once per
client per local day.

---

# Shared rows and multi-writer records

## W1. One writer creates a row; everyone else patches it

Where two features write the same row, exactly one of them may create it.
Every other writer updates an existing row by primary key and never upserts.

`workout_logs` is the case in this app: the logger and the warmup toggle both
write the same `(client_id, date)` row. Two independent upserts against one
conflict key with different column sets is a latent clobber — it survives only
as long as every payload happens to name the right columns, and breaks
silently the first time someone adds a column to either.

The correct shape: the warmup toggle creates a stub only when no log exists
for that date, and patches by id thereafter. The logger owns creation
otherwise.

Related, and required: **a stub log is only created for a date that actually
has a scheduled workout.** Nothing should be able to write a `workout_logs`
row for a rest day.

## W2. Independent completion states stay independent

Finishing a warm-up and finishing a workout are separate facts. Neither gates
the other, and completing one must never clear or imply the other.

`workout_logs.warmup_completed` and `completed` are deliberately separate
columns. Keep any future completion state (a cooldown, a check-in) equally
independent rather than folding it into one status field.

