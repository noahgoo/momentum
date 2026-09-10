import { describe, expect, it } from "vitest";
import type { MotivationEntry } from "./domain.js";
import { isMotivationOverrideActive, resolveMotivation } from "./motivation.js";

const weekly = { quote: "Weekly quote", image_url: "weekly.jpg" } as MotivationEntry;

function overrideProfile(quote: string | null, until: string | null = null, image: string | null = null) {
  return {
    motivation_override_quote: quote,
    motivation_override_image_url: image,
    motivation_override_until: until,
  };
}

describe("isMotivationOverrideActive", () => {
  it("treats a missing until as never expiring", () => {
    expect(isMotivationOverrideActive(null, "2026-05-13")).toBe(true);
    expect(isMotivationOverrideActive("", "2026-05-13")).toBe(true);
  });

  it("includes the until day itself", () => {
    expect(isMotivationOverrideActive("2026-05-13", "2026-05-13")).toBe(true);
  });

  it("expires the day after until", () => {
    expect(isMotivationOverrideActive("2026-05-12", "2026-05-13")).toBe(false);
  });
});

describe("resolveMotivation", () => {
  it("prefers an active override over the weekly entry", () => {
    const r = resolveMotivation(overrideProfile("You got this", "2026-05-20", "o.jpg"), weekly, "2026-05-13");
    expect(r).toEqual({ quote: "You got this", imageUrl: "o.jpg", source: "override" });
  });

  it("falls back to weekly once the override expires", () => {
    const r = resolveMotivation(overrideProfile("You got this", "2026-05-12"), weekly, "2026-05-13");
    expect(r?.source).toBe("weekly");
    expect(r?.quote).toBe("Weekly quote");
  });

  it("ignores an override that is empty or whitespace only", () => {
    expect(resolveMotivation(overrideProfile(""), weekly, "2026-05-13")?.source).toBe("weekly");
    expect(resolveMotivation(overrideProfile("   "), weekly, "2026-05-13")?.source).toBe("weekly");
    expect(resolveMotivation(overrideProfile(null), weekly, "2026-05-13")?.source).toBe("weekly");
  });

  it("trims the override quote", () => {
    expect(resolveMotivation(overrideProfile("  Go  "), weekly, "2026-05-13")?.quote).toBe("Go");
  });

  it("shows an override even with no weekly entry", () => {
    expect(resolveMotivation(overrideProfile("Solo"), null, "2026-05-13")?.source).toBe("override");
  });

  it("returns null when there is nothing to show", () => {
    expect(resolveMotivation(overrideProfile(null), null, "2026-05-13")).toBeNull();
    expect(resolveMotivation(null, null, "2026-05-13")).toBeNull();
  });
});
