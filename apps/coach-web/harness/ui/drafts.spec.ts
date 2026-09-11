import { DRAFT_DEBOUNCE_MS, addFirstExercise, test, expect, visit } from "./fixtures";

/**
 * Autosave for the builders (docs/rules/offline-perf.md S1).
 *
 * The failure these guard against is the expensive kind: a coach loses an hour
 * of program building and there is nothing in a log to explain it. Ordering is
 * what makes it fragile — the draft has to be applied after the server
 * hydration effect, and the write has to wait for hydration, or one silently
 * overwrites the other.
 */

const NAME = "e.g. Upper body strength";
const EQUIPMENT = "dumbbells, bench, mat";
const RESTORED = "Restored your unsaved progress";

test.describe("builder drafts", () => {
  test.beforeEach(async ({ page }) => {
    // The nav guard prompts on leaving a dirty builder; accept unless a test
    // installs its own handler.
    page.on("dialog", (d) => d.accept());
  });

  test("restores a new workout after a reload, and says so", async ({ page, isMobile }) => {
    await visit(page, "/library/workouts/new");
    await page.getByPlaceholder(NAME).fill("Leg Day Draft");
    await page.getByPlaceholder(EQUIPMENT).fill("barbell, rack");
    await addFirstExercise(page, Boolean(isMobile));
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);

    await visit(page, "/library/workouts/new");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("Leg Day Draft");
    await expect(page.getByPlaceholder(EQUIPMENT)).toHaveValue("barbell, rack");
    await expect(page.getByText("Barbell Bench Press").first()).toBeVisible();
    await expect(page.getByText(RESTORED)).toBeVisible();
  });

  test("discard clears the form and does not come back", async ({ page }) => {
    await visit(page, "/library/workouts/new");
    await page.getByPlaceholder(NAME).fill("Abandon Me");
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);

    await visit(page, "/library/workouts/new");
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByPlaceholder(NAME)).toHaveValue("");
    await expect(page.getByText(RESTORED)).toHaveCount(0);

    await visit(page, "/library/workouts/new");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("");
    await expect(page.getByText(RESTORED)).toHaveCount(0);
  });

  test("a failed save leaves the draft intact", async ({ page, isMobile }) => {
    // The case the whole feature exists for: the save did not land, so the
    // local copy is the only one there is.
    await visit(page, "/library/workouts/new");
    await page.evaluate(() => {
      (window as unknown as { __harness: { failWrites: boolean } }).__harness.failWrites = true;
    });
    await page.getByPlaceholder(NAME).fill("Survives Failure");
    await addFirstExercise(page, Boolean(isMobile));
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);
    await page.getByRole("button", { name: /Save workout/ }).click();

    // describeSaveWorkoutError falls through to the raw message for an
    // unrecognized code (rpcErrors.ts), so assert an error rendered rather than
    // pinning the wording.
    await expect(page.locator('[class*="--bad"]').filter({ hasText: /\S/ }).first()).toBeVisible();

    await visit(page, "/library/workouts/new");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("Survives Failure");
  });

  test("a successful save clears the draft", async ({ page, isMobile }) => {
    await visit(page, "/library/workouts/new");
    await page.getByPlaceholder(NAME).fill("Will Be Saved");
    await addFirstExercise(page, Boolean(isMobile));
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);
    await page.getByRole("button", { name: /Save workout/ }).click();
    await page.waitForTimeout(600);

    await visit(page, "/library/workouts/new");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("");
    await expect(page.getByText(RESTORED)).toHaveCount(0);
  });

  test("a warmup draft does not leak into the workout builder", async ({ page }) => {
    // Same component behind two routes, so the draft key has to carry the noun.
    await visit(page, "/library/warmups/new");
    await page.getByPlaceholder(NAME).fill("Warmup Only");
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);

    await visit(page, "/library/workouts/new");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("");

    await visit(page, "/library/warmups/new");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("Warmup Only");
  });

  test("in edit mode the draft wins over server hydration", async ({ page }) => {
    await visit(page, "/library/workouts/w-1");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("Upper Body Push A");

    await page.getByPlaceholder(NAME).fill("Upper Body Push A (edited)");
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);

    await visit(page, "/library/workouts/w-1");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("Upper Body Push A (edited)");
    await expect(page.getByText(RESTORED)).toBeVisible();

    // Discarding falls back to the server's copy rather than emptying the form.
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByPlaceholder(NAME)).toHaveValue("Upper Body Push A");
  });

  test("a draft older than the server's copy is discarded, not restored", async ({ page }) => {
    // What another device's save leaves behind. Restoring it would resurrect
    // stale values over fresher ones (shouldRestoreDraft in packages/shared).
    const key = "momentum.draft:coach-1:workout:w-1";
    await visit(page, "/library/workouts");
    await page.evaluate((k) => {
      localStorage.setItem(
        k,
        JSON.stringify({
          savedAt: Date.parse("2026-08-20T10:00:00Z"), // fixture updatedAt is 2026-09-01
          drafts: {
            name: "STALE DRAFT",
            description: "",
            durationStr: "",
            equipmentStr: "",
            warmupId: "",
            exercises: [],
          },
        })
      );
    }, key);

    await visit(page, "/library/workouts/w-1");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("Upper Body Push A");
    await expect(page.getByText(RESTORED)).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  });

  test("the program builder restores name and schedule", async ({ page }) => {
    await visit(page, "/library/programs/new");
    await page.locator("input").first().fill("Draft Program");
    await page.getByRole("button", { name: "Mon" }).click();
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);

    await visit(page, "/library/programs/new");
    await expect(page.locator("input").first()).toHaveValue("Draft Program");
    await expect(page.getByText(RESTORED)).toBeVisible();
    // An active day is filled rather than outlined, which is how it reads as on.
    const mondayBg = await page
      .getByRole("button", { name: "Mon" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(mondayBg).not.toBe("rgba(0, 0, 0, 0)");
  });
});
