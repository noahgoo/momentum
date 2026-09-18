# Momentum

pnpm monorepo: `apps/*` (Expo client, Vite coach web), `packages/*` (shared code), `supabase/` (backend).

See `docs/` and the project plan for details.

## Dev servers

```bash
pnpm -F coach-web dev     # web, localhost:5173
pnpm -F mobile start      # Expo, scan QR or press i/a
pnpm -F mobile ios        # local ios sim
```

UI harness (coach-web, no auth/network needed):

```bash
pnpm -F coach-web harness     # localhost:5199
pnpm -F coach-web test:ui     # UI checks, 1440px + 390px
```
