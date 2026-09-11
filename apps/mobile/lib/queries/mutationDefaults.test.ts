import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A mutation queued while offline is persisted as { mutationKey, variables }.
 * On restart, resumePausedMutations looks the key up in the registered
 * defaults — and a key with no default is SILENTLY DROPPED, taking the
 * client's logged workout with it.
 *
 * Nothing in the type system connects the two, so this checks the parity
 * directly against the source.
 */
const dir = __dirname;

function keysIn(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => m[1]).sort();
}

describe("offline mutation replay", () => {
  const defaults = readFileSync(join(dir, "mutationDefaults.ts"), "utf8");
  const registered = keysIn(defaults, /setMutationDefaults\(\["([^"]+)"\]/g);

  const hookFiles = [
    "useSaveWorkoutLog",
    "useWarmupToggle",
    "useSendMessage",
    "useToggleGoalLog",
    "useCreateBodyMeasurement",
  ];
  const used = hookFiles
    .flatMap((f) => keysIn(readFileSync(join(dir, `${f}.ts`), "utf8"), /mutationKey: \["([^"]+)"\]/g))
    .sort();

  it("registers a default for every keyed mutation", () => {
    // Without this, a write made offline is restored with no function to
    // call and vanishes.
    expect(used.filter((k) => !registered.includes(k))).toEqual([]);
  });

  it("has no default without a hook using it", () => {
    // A stale default means a rename left the real hook unqueueable.
    expect(registered.filter((k) => !used.includes(k))).toEqual([]);
  });

  it("keys every hook whose write must survive going offline", () => {
    expect(used).toEqual([
      "createBodyMeasurement",
      "saveWorkoutLog",
      "sendMessage",
      "setWarmupCompleted",
      "toggleGoalLog",
    ]);
  });
});
