import { describe, expect, it } from "vitest";
import { shouldRestoreDraft } from "./draft.js";

const SERVER = "2026-06-15T12:00:00.000Z";
const serverMs = new Date(SERVER).getTime();

describe("shouldRestoreDraft", () => {
  it("restores a draft written after the server's copy", () => {
    expect(shouldRestoreDraft(serverMs + 1000, SERVER)).toBe(true);
  });

  it("discards a draft older than the server's copy", () => {
    // Already superseded — e.g. the client saved from another device.
    expect(shouldRestoreDraft(serverMs - 1000, SERVER)).toBe(false);
  });

  it("discards a draft written at exactly the server time", () => {
    // Ties go to the server: it is the durable copy.
    expect(shouldRestoreDraft(serverMs, SERVER)).toBe(false);
  });

  it("restores when there is no server copy at all", () => {
    // Nothing has been saved yet, so the draft is the only record.
    expect(shouldRestoreDraft(serverMs, null)).toBe(true);
    expect(shouldRestoreDraft(serverMs, undefined)).toBe(true);
  });

  it("restores when the server timestamp is unparseable", () => {
    // Never cost a client their entry over a malformed timestamp.
    expect(shouldRestoreDraft(serverMs, "not-a-date")).toBe(true);
  });

  it("discards a draft with a missing or malformed savedAt", () => {
    expect(shouldRestoreDraft(undefined, SERVER)).toBe(false);
    expect(shouldRestoreDraft(Number.NaN, SERVER)).toBe(false);
    expect(shouldRestoreDraft(Infinity, SERVER)).toBe(false);
  });
});
