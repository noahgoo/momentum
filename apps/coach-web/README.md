# coach-web

Vite + React SPA for the Momentum coach portal. Coach-only — client-role
logins are rejected at the auth gate.

## Setup

```bash
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_KEY
pnpm install            # from the repo root
```

## Scripts

```bash
pnpm -F coach-web dev         # start the dev server
pnpm -F coach-web build       # typecheck + production build
pnpm -F coach-web typecheck   # tsc -b --noEmit
pnpm -F coach-web lint        # eslint
pnpm -F coach-web preview     # preview a production build
```

## Seeded coach login (dev/staging)

```
email:    coach1@momentum.test
password: password123
```

A `role: client` login is signed out immediately with "This portal is for
coaches."
