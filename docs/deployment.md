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
