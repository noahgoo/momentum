# harness

Boots the coach portal with no backend, so its UI can be looked at and checked.

```bash
pnpm -F coach-web harness     # browsable app at localhost:5199, fixture data
pnpm -F coach-web test:ui     # the checks in ui/, against that harness
```

`test:ui` starts the harness itself — nothing to run first.

## Why it exists

`src/lib/supabase.ts` throws at import when `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY`
are missing, and `RequireAuth` bounces every route to `/login` without a coach
session. So without credentials the app cannot render at all, and there is no
way to confirm a UI change by looking at it.

Typecheck, lint and build all pass on a portal that is broken on screen. Both
bugs listed under "What it has caught" did exactly that.

## How it works

Two pieces, about 200 lines:

- **`vite.harness.config.ts`** (in the app root) — a Vite plugin that
  intercepts module resolution. Anything importing `src/lib/supabase` or
  `src/lib/auth` gets `stub-supabase.ts` / `stub-auth.tsx` instead. Matching is
  by *resolved path*, because importers reach those modules through different
  relative paths.
- **`main.tsx`** — mounts `AppRoutes` from `src/App.tsx`, the same route table
  the real app uses, inside a query client seeded from `fixtures.ts`.

Nothing in `src/` is modified and nothing inside a component is mocked. What
renders is the real layout, the real hooks, the real state.

Two details that look odd and are not:

- **Reads hang rather than resolving.** If the Supabase stub returned empty
  results, the first refetch after mount would overwrite the seeded fixtures
  and every screen would show its empty state.
- **Fixtures are typed** against the same types the hooks return. A schema
  change or a reshaped hook then fails `pnpm typecheck` instead of quietly
  rendering a blank list that someone has to debug. That has already cost two
  debugging sessions.

## What it has caught

- `useBlocker` requires a *data* router. The app mounts a plain
  `BrowserRouter`, so the call threw on mount and took both builder pages down.
- `mx-auto` on a page root suppresses cross-axis stretch inside a flex column,
  so three pages sized to their content and overflowed sideways.

It also makes negative claims checkable. Desktop geometry was confirmed
byte-identical across a refactor by measuring it, which no amount of reading
the diff would have established.

## Adding to it

- **A new route** needs nothing. `AppRoutes` is shared, so the layout checks
  pick it up automatically — add it to `ROUTES` in `ui/fixtures.ts` if it needs
  a fixture.
- **New data** goes in `fixtures.ts`, typed. Prefer awkward values: a name long
  enough to overflow a phone, an entity with nothing attached to it. Tidy
  fixtures do not catch layout bugs.
- **Width-dependent behaviour** belongs in a helper, not an `if` in a test —
  see `addFirstExercise`, where the desktop rail and the mobile sheet are two
  routes to the same thing.

## Browsers

`npx playwright install chromium` once per machine.

Where a Chromium is already provisioned and does not match the build Playwright
expects (sandboxes, CI images), point at it instead of downloading a second
copy:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium pnpm -F coach-web test:ui
```

The `phone` project runs Chromium with an iPhone viewport rather than WebKit,
to keep this to one browser. What it measures — layout, storage, focus — does
not depend on the engine. Switch it to WebKit if Safari-specific rendering ever
needs covering.

## What it is not

Not a substitute for running against a real Supabase. It cannot catch anything
about RLS, migrations, RPC behaviour, realtime, or whether a query returns what
its types claim. It only covers what happens in the browser once data arrives.
