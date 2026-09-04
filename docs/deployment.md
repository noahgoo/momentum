# Deployment

## Supabase (already live)

- Project: **Momentum App** (`ohozbjcdsgnhqtaqneke`, org "Momentum", us-west-1)
- 18 migrations applied via `supabase db push` (repo `supabase/migrations/` is the source of truth; forward-only)
- Seed: `supabase db query -f supabase/seed.sql --linked` — idempotent, self-repairing; all accounts use password `password123` (coach1/coach2/client1..10 @momentum.test)
- Regenerate types after any schema change: `pnpm gen:types` (writes `packages/shared/src/db-types.ts`)
- pg_cron jobs: daily maintenance (summaries + friendship stats), hourly reminder outbox

## Coach web → Vercel

- Root directory: `apps/coach-web`, framework Vite, build `pnpm -F coach-web build`, output `apps/coach-web/dist`
- Env vars (Production + Preview):
  - `VITE_SUPABASE_URL=https://ohozbjcdsgnhqtaqneke.supabase.co`
  - `VITE_SUPABASE_KEY=<publishable key>` (Dashboard → Settings → API)
- SPA rewrite: all routes → `/index.html` (Vercel detects Vite; add a rewrite if deep links 404)

## Mobile → Expo

- Dev: `pnpm -F mobile dev` → Expo Go on device (env in `apps/mobile/.env`, see `.env.example`)
- Store builds (post-MVP): EAS (`eas build`) — requires Expo account + Apple Developer Program ($99/yr) / Google Play Console

## Deferred (post-MVP)

- **Push delivery**: reminder rows queue in `notification_outbox`; needs an Edge Function consumer + `expo-notifications` token registration + EAS credentials. Coach "Notifications" composer is stubbed until then.
- **Client invites by email**: Edge Function + SMTP; "Invite client" button is stubbed. Create clients meanwhile via Supabase Auth dashboard (metadata: `role=client`, `invited_by=<coach uuid>`; the signup trigger builds the profile).
- **New coaches**: create manually the same way with `role=coach`.

## Notification delivery

The reminder pipeline has two halves and both must be deployed:

1. **Producer** — `run_reminders()` runs on pg_cron every 15 minutes and
   queues rows into `notification_outbox`. Applied with the migrations.
2. **Consumer** — the `send-notifications` Edge Function reads the queue and
   sends via Expo Push. Deploy it separately:

   ```
   supabase functions deploy send-notifications
   ```

   It runs as the service role and needs `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` in the function environment (both are provided
   by default on Supabase-hosted functions).

   Schedule it just after the producer, e.g. via pg_cron with `net.http_post`
   or an external scheduler, every 15 minutes.

**Deploying the producer without the consumer means clients are promised
reminders that never arrive** — that was the state this work fixed
(violation N-1). If the consumer cannot be deployed yet, turn the reminder
controls off in the client rather than leaving them enabled.

Verify end to end: set a reminder a quarter-hour out on a real device,
confirm the push arrives and that `notification_outbox.sent_at` is stamped.
