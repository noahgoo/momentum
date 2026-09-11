/* eslint-disable @typescript-eslint/no-explicit-any -- the point of this file is
   to stand in for a client whose surface is far too wide to model. */

/**
 * Replaces src/lib/supabase.ts, which throws at import when the env vars are
 * missing — so without this the app cannot boot here at all.
 *
 * Reads hang rather than resolving. That is deliberate: if they resolved to
 * empty results, the first refetch after mount would overwrite the seeded
 * fixtures and every screen would render its empty state instead of the data
 * the test is about.
 *
 * Writes go through `rpc`, which resolves so a save can be driven end to end.
 * Tests flip `window.__harness.failWrites` to make one reject, which is how
 * "the draft survives a failed save" is exercised.
 */

export interface HarnessControl {
  failWrites: boolean;
}

const control: HarnessControl = { failWrites: false };
(globalThis as any).__harness = control;

function chain(): any {
  const target: any = () => chain();
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return () => undefined; // a thenable that never settles
      if (prop === "toString" || prop === Symbol.toPrimitive) return () => "[harness stub]";
      return chain();
    },
    apply: () => chain(),
  });
}

export const supabase: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "rpc") {
        return async () =>
          control.failWrites
            ? { data: null, error: { message: "network unreachable" } }
            : { data: "harness-saved-id", error: null };
      }
      return chain()[prop as string];
    },
  }
);
