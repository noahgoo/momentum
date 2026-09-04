/**
 * Outbox consumer: turns queued notification rows into Expo push messages.
 *
 * `run_reminders` has been writing rows that nothing read — sent_at was never
 * stamped and no push was ever sent, while the settings screen promised
 * reminders (violation N-1). This is the missing half.
 *
 * Runs as the service role (bypassing RLS) on a schedule, right after
 * run_reminders. See docs/rules/notifications.md N1-N4.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Past this many attempts a row is left alone rather than retried forever. */
const MAX_ATTEMPTS = 5;
/** Expo accepts at most 100 messages per request. */
const BATCH_SIZE = 100;

/**
 * Expo ticket errors that mean the token will NEVER work again. Retrying
 * these forever is the classic outbox leak, so the token is deleted instead.
 */
const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered", "InvalidCredentials"]);

interface OutboxRow {
  id: string;
  profile_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/** Exponential backoff: 2, 4, 8… minutes, so a flaky provider is not hammered. */
function nextAttemptAt(attempts: number): string {
  return new Date(Date.now() + Math.pow(2, attempts + 1) * 60_000).toISOString();
}

/**
 * N3: a reminder queued 15 minutes ago may no longer be true — the client may
 * have finished the workout, or the coach may have moved it. Re-check at send
 * time rather than delivering something stale.
 */
async function stillWorthSending(row: OutboxRow): Promise<boolean> {
  if (row.kind !== "workout_reminder") return true;

  const date = row.payload?.date as string | undefined;
  if (!date) return false;

  const { data: log } = await supabase
    .from("workout_logs")
    .select("completed")
    .eq("client_id", row.profile_id)
    .eq("date", date)
    .maybeSingle();

  return !log?.completed;
}

function describe(row: OutboxRow): { title: string; body: string } {
  switch (row.kind) {
    case "workout_reminder":
      return { title: "Today's workout", body: "You have a workout scheduled today." };
    default:
      return { title: "Momentum", body: "You have an update." };
  }
}

Deno.serve(async () => {
  const { data: due, error } = await supabase
    .from("notification_outbox")
    .select("id, profile_id, kind, payload, attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .lte("next_attempt_at", new Date().toISOString())
    .limit(BATCH_SIZE);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (due ?? []) as OutboxRow[];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let deadTokens = 0;

  for (const row of rows) {
    if (!(await stillWorthSending(row))) {
      // Not a failure: the reason to send went away. Mark it done so it does
      // not sit in the queue being re-evaluated forever.
      await supabase
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: "skipped: no longer applicable" })
        .eq("id", row.id);
      skipped++;
      continue;
    }

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("profile_id", row.profile_id);

    if (!tokens || tokens.length === 0) {
      // Nobody to deliver to. Retrying would never help.
      await supabase
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString(), last_error: "skipped: no registered device" })
        .eq("id", row.id);
      skipped++;
      continue;
    }

    const { title, body } = describe(row);
    // Ids and a date only — never text rendered at queue time (N3).
    const messages = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      data: { kind: row.kind, ...row.payload },
    }));

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });

      if (!response.ok) throw new Error(`Expo responded ${response.status}`);

      const result = await response.json();
      const tickets: { status: string; details?: { error?: string } }[] = result.data ?? [];

      for (let i = 0; i < tickets.length; i++) {
        const detail = tickets[i]?.details?.error;
        if (detail && DEAD_TOKEN_ERRORS.has(detail)) {
          // The app was uninstalled. Clear the token so it is not retried on
          // every future notification (N2).
          await supabase.from("push_tokens").delete().eq("token", messages[i].to);
          deadTokens++;
        }
      }

      await supabase
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq("id", row.id);
      sent++;
    } catch (err) {
      // Transient: back off and let a later run pick it up.
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("notification_outbox")
        .update({
          attempts: row.attempts + 1,
          last_error: message,
          next_attempt_at: nextAttemptAt(row.attempts),
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ considered: rows.length, sent, skipped, failed, deadTokens }),
    { headers: { "Content-Type": "application/json" } }
  );
});
