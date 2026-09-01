# Momentum — Mobile (Expo)

React Native (Expo SDK 57, expo-router v57) client app for Momentum. Auth
gate, tab shell, theme tokens, and device-timezone sync only — feature
screens (dashboard widgets, workout logger, goals, etc.) land in later
slices. This app is client-only: a `coach`-role account is rejected at
sign-in with a message pointing to the coach web portal.

## Running

```bash
# from the monorepo root
pnpm install
pnpm -F mobile dev        # expo start — press i/a/w for iOS sim / Android / web
```

Or from this directory: `pnpm dev` (same script). Scan the QR code with
Expo Go, or press `i`/`a` for a simulator, or `w` for the web build.

Seeded client credentials (from `supabase/seed`): **client1@momentum.test /
password123**.

## Environment

Copy `.env.example` to `.env` and fill in your Supabase project's URL and
publishable (anon) key:

```bash
cp .env.example .env
```

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx
```

`.env` is gitignored (via the repo root `.gitignore`'s `.env*` rule);
`.env.example` is tracked. Both `EXPO_PUBLIC_*` vars are inlined into the
client bundle at build time (Expo's convention for public runtime config)
— never put a secret/service-role key behind an `EXPO_PUBLIC_` name.

## pnpm + Expo/Metro: hoisted node_modules

**The workspace root `.npmrc` sets `node-linker=hoisted`.** This affects
the whole monorepo, not just this app — flagging it here since other
agents/contributors share that file.

Why: Metro's module resolver does not reliably follow pnpm's default
strict, symlinked `node_modules/.pnpm` layout. Several Expo/RN packages
reach into transitive dependencies that pnpm keeps isolated from a
package that doesn't declare them directly (e.g. `expo-router` needs
`standard-navigation`; `react-native-web` needs
`@react-native/normalize-colors`). With the default linker, `expo export`
and `expo start` fail with "Unable to resolve module X" for each of these
in turn. Hoisting flattens `node_modules` so Metro can find them, matching
the layout Expo's tooling assumes (npm/yarn-style).

This was confirmed to only work from the **workspace root** `.npmrc` — a
`node-linker` setting in `apps/mobile/.npmrc` alone is silently ignored by
pnpm; the setting is install-wide.

`metro.config.js` additionally sets `watchFolders`/`nodeModulesPaths` to
the workspace root and enables `unstable_enablePackageExports` so Metro
can resolve the `@momentum/shared` workspace package (symlinked in via
pnpm) and follow its subpath exports correctly.

## Architecture notes

- **`lib/supabase.ts`** — `createClient<Database>` (from `@momentum/shared`,
  which re-exports the generated `Database`/`Json` types from
  `db-types.ts`) with a custom `SupportedStorage` adapter:
  - **Native (iOS/Android):** backed by `expo-secure-store`, chunked into
    ≤1800-byte pieces (SecureStore's hard limit is 2048 bytes/value, and a
    Supabase session — access + refresh token + user metadata — routinely
    exceeds that). This is the simplest reliable option that keeps
    everything inside the OS keychain/keystore, at the cost of a few extra
    key reads per session load. (The alternative — AES-encrypting the
    session in AsyncStorage with a small SecureStore-held key — was not
    used, to avoid adding a crypto dependency for this slice.)
  - **Web:** falls back to `AsyncStorage` (SecureStore is native-only).
  - **Node/SSR (`expo export`'s static-rendering pass):** falls back to a
    safe no-op. The web bundle is executed once under Node with no
    `window`/`document` to prerender each route's HTML shell, and the
    Supabase client (constructed at module scope) must not throw there.
  - Distinguished via `Platform.OS === "web"` plus a `typeof window`
    check — **not** `typeof document`, which is also `undefined` under
    Node and would misroute the Node case into the native/SecureStore
    branch (confirmed by hitting exactly that failure while validating the
    export).
- **`lib/auth.tsx`** — `AuthProvider` wraps `supabase.auth.onAuthStateChange`,
  loads the signed-in user's `profiles` row, and rejects `role === "coach"`
  (signs out immediately, surfaces `error` for the login screen to show).
  Exposes `{ session, profile, loading, error, signOut }` via `useAuth()`.
- **`lib/timezone.ts` + `lib/useTimezoneSync.ts`** — device timezone is the
  source of truth (no manual picker anywhere in this app). Reads
  `expo-localization`'s `Localization.getCalendars()[0].timeZone` (falling
  back to the older `.timezone` field) and upserts `profiles.timezone`
  whenever it differs from what's stored, on sign-in and again every time
  the app returns to the foreground (`AppState` listener) — covers a
  device timezone change (e.g. travel) while the app was backgrounded.
- **`theme/tokens.ts`** — full token set ported from
  `mindful-miya/src/app/globals.css` (reference only, not modified):
  cream/blue/ink+alpha ramp/paper/line/ok/bad/warn, 24px/14px radii,
  Fraunces (italic, display) + Inter (body) via `@expo-google-fonts/*`.
- **`app/`** (expo-router): `_layout.tsx` wires `QueryClientProvider` +
  `AuthProvider` + font loading + a headless `TimezoneSyncGate` (keeps the
  `useAuth()`-dependent sync hook inside the provider tree without coupling
  it to the root layout component itself). `index.tsx` is the auth gate →
  redirects to `/login` or `/(tabs)/dashboard`. `(tabs)/` holds the six
  placeholder tab screens (dashboard, workout, goals, progress, messages,
  friends) sharing one `PlaceholderScreen` component. `settings.tsx` is
  outside the tab group with a working sign-out action.

## Verification run for this slice

- `pnpm -F mobile typecheck` — passes.
- `npx expo export --platform web` — bundles and statically renders all 17
  routes without errors (chosen over `--platform ios` since this sandbox
  has no macOS toolchain/simulator; web export still proves the app
  compiles through Metro end-to-end, including workspace-package
  resolution and the storage-adapter environment branching above).
