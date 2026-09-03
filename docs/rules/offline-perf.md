# Persistence, offline, and performance

When data is written, what survives a crash, and how fast a screen appears.
Read this before touching a form, a query hook, the query client, or any
screen with a load path.

Clients use this app in gyms — basements, concrete, dead zones. Bad
connectivity is the normal case, not the edge case. A client mid-workout has
already done the work; losing their record of it is the worst failure this app
can produce, worse than any wrong number, because they cannot reconstruct it
from memory.

These rules govern when data is written, what survives a crash, and how fast
a screen appears.

## S1. In-progress work is never lost

Any form a user can spend more than a few seconds filling in autosaves its
draft to device storage. Exiting, backgrounding, crashing, or being reclaimed
by the OS must never destroy entered data.

This applies most to the workout logger, and also to message composition,
program/workout builders, and measurement entry.

- Draft state persists locally on change, keyed by what it belongs to
  (client + date + workout).
- Returning to the screen restores the draft and says so ("Restored your
  unsaved progress") rather than silently resurrecting values.
- A draft is cleared only once its content is durably saved to the server.
- Component `useState` alone is not persistence. Unpersisted local state is
  acceptable only for genuinely transient UI — an open modal, a toggled
  accordion.

## S2. The workout logger saves as the client works

The client is holding weights, sweating, mid-set. They should never have to
think about saving, and never lose a set because they didn't.

| Action | Behavior |
| --- | --- |
| Typing in a field | Local draft only. No network. |
| Field blur | Local draft only. |
| Checking a set off | Debounced background save (~2s). |
| "Complete ✓" | Immediate write, finalizes the log. |

Checking a set off is the discrete, meaningful moment — it means "I did this"
— so it is what triggers a save. Typing does not, because partially-typed
values ("13" on the way to "135") should not reach the server.

Background saves are silent on success. They never block input, never show a
spinner over the form, and never steal focus. Failure is surfaced as a quiet,
persistent indicator ("Not saved — will retry"), never a modal or a toast that
interrupts a set.

## S3. Offline is a supported state, not an error

A client with no signal can open the app, see today's workout, log the entire
session, and have it sync when they reconnect. The app never blocks logging on
connectivity.

Required pieces:

- **The query cache persists to AsyncStorage**, so a cold start with no
  network still renders the last-known workout, program, and goals rather than
  a spinner or an error.
- **`onlineManager` is wired to NetInfo.** Without it React Query does not
  know the device is offline and fires requests that fail instead of pausing.
- **Mutations queue and replay on reconnect.** A queued mutation survives an
  app restart. Replay is ordered, and idempotent per C4 so a replayed write is
  safe.
- **Offline state is visible and calm.** A persistent, unobtrusive indicator
  ("Offline — changes will sync"), and on reconnect a resolution ("All changes
  saved"). Never an error dialog for an expected condition.

Cached data displayed offline is labeled as of when it was fetched wherever
staleness could mislead — per C8.

**Writes that must not queue offline** are those whose meaning depends on
current server state: accepting a change request, assigning a program. These
require connectivity and say so plainly. Client-owned logging never does.

## S4. Cache lifetimes are chosen per query, not inherited

The global default (`staleTime: 30s`) is a starting point, not a decision.
Each query sets a lifetime matching how fast its data actually changes and how
bad it is to show a stale value.

Rough tiers:

- **Static / rarely changing** (exercise library, a workout's definition):
  long `staleTime`, minutes. Cheap to cache, jarring to refetch constantly.
- **Client-owned and self-modified** (today's workout, goals, logs): short —
  the user's own writes update it optimistically anyway.
- **Live and shared** (messages, unread counts, coach dashboard summaries):
  realtime-driven. The subscription is what keeps them fresh; `staleTime`
  mainly controls refetch on focus.

`gcTime` outlives `staleTime` — a screen the user returns to should paint from
cache instantly, then revalidate. Persisted queries need a `gcTime` long
enough to be worth persisting.

## S5. Screens paint from cache first, then revalidate

Never show a blank screen or a full-screen spinner for data that has been
loaded before. Render the cached value immediately, refresh in the background,
and update in place.

- **First-ever load** (no cache): a skeleton matching the real layout, not a
  spinner. No layout shift when data arrives.
- **Return visit**: cached content immediately, with a subtle refreshing
  indicator if the refetch is slow.
- **Refetch after mutation**: no visible loading state at all — the optimistic
  value already reflects the change.

Pull-to-refresh is available on every list and detail screen, and is the only
place a client should see an explicit loading spinner for already-cached data.

## S6. Load-time budgets

Targets for the client app on typical gym LTE (~200ms RTT), measured from
navigation to meaningful content:

| Screen | Cold (no cache) | Warm (cached) |
| --- | --- | --- |
| Today's workout | < 1.5s | < 200ms |
| Workout day / logger | < 1.5s | < 200ms |
| Dashboard | < 2s | < 300ms |
| History, lists | < 2s | < 300ms |

Warm targets assume S3's persisted cache: a returning client sees content
essentially instantly, before any network call resolves.

The rules that keep these met:

- **Round trips are the cost, not payload size.** Sequential dependent
  fetches are what make a screen slow. Batch with joins, or run independent
  fetches in `Promise.all` — never await one query only to start another that
  didn't depend on it.
- **A screen's data is one query hook** where practical, composing its fetches
  internally, rather than several hooks each triggering their own waterfall.
- **Never N+1.** Collect ids and use one `.in()` — `useWorkoutHistory` does
  this correctly.
- **Fetch what the screen renders.** `select("*")` on a table with wide or
  rarely-used columns is waste on a slow link.

`useWorkoutDay` is the current worst case and the one to measure against: it
awaits the assignment context, then a batch of three, then a further batch of
two for the warmup — a four-level waterfall on the app's hottest screen.

---

