import { addFirstExercise, test, expect, visit } from "./fixtures";

/**
 * The two progressive-overload controls in the exercise editor
 * (docs/rules/workout-numbers.md).
 *
 * Both write per-exercise but STORE per-set, the same shape as the weight-unit
 * toggle. That is the part worth guarding: a regression here writes the flag to
 * set 1 only, which typechecks, renders fine, and silently prescribes the wrong
 * thing from set 2 onward.
 */

const NAME = "e.g. Upper body strength";

/** Opens the first exercise's editor, which is collapsed by default. */
async function addAndExpandExercise(page: Parameters<typeof addFirstExercise>[0], isMobile: boolean) {
  await visit(page, "/library/workouts/new");
  await page.getByPlaceholder(NAME).fill("Prescription Test");
  await addFirstExercise(page, isMobile);
  await page.getByRole("button", { name: "Edit" }).first().click();
}

test.describe("exercise prescription controls", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => d.accept());
  });

  test("each-side toggle applies to every set, not just the first", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));

    await page.getByRole("button", { name: "+ Add set" }).click();
    await page.getByRole("button", { name: "+ Add set" }).click();

    const eachSide = page.getByRole("switch", { name: "Reps are per side" });
    await expect(eachSide).toHaveAttribute("aria-checked", "false");
    await eachSide.click();
    await expect(eachSide).toHaveAttribute("aria-checked", "true");

    // The summary reads off every config, so "/side" here means the flag
    // reached all of them rather than only set 1.
    await page.getByRole("button", { name: "Close" }).first().click();
    await expect(page.getByText("/side").first()).toBeVisible();
  });

  test("increment toggle swaps the weight input for a read-only chip", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));

    // Fixed mode: the weight cell is editable.
    const weightInput = page.getByPlaceholder("-").first();
    await expect(weightInput).toBeVisible();
    await weightInput.fill("95");

    await page.getByRole("switch", { name: "Target from last weight" }).click();

    // Relative mode: no editable weight, a chip stating the rule instead.
    await expect(page.getByPlaceholder("-")).toHaveCount(0);
    await expect(page.getByText("Last +5 lbs", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Increment from last weight" })).toBeVisible();
  });

  test("toggling the increment off restores the coach's fixed weight", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));

    await page.getByPlaceholder("-").first().fill("95");
    const increment = page.getByRole("switch", { name: "Target from last weight" });

    await increment.click();
    await expect(page.getByPlaceholder("-")).toHaveCount(0);

    // The whole reason weight and weightDelta coexist: turning the rule off
    // must not have cost the coach the number they typed.
    await increment.click();
    await expect(page.getByPlaceholder("-").first()).toHaveValue("95");
  });

  test("changing the increment updates every set's chip", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));
    await page.getByRole("button", { name: "+ Add set" }).click();

    await page.getByRole("switch", { name: "Target from last weight" }).click();
    await page
      .getByRole("combobox", { name: "Increment from last weight" })
      .selectOption("10");

    // Compare against the actual set count rather than a hardcoded number —
    // the library exercise seeds its own default_sets, so the total is not
    // ours to assume. One chip per set is the property under test.
    const setCount = await page.getByRole("button", { name: "Remove set" }).count();
    expect(setCount).toBeGreaterThan(1);
    // exact, or this also matches every ancestor container holding the chip.
    await expect(page.getByText("Last +10 lbs", { exact: true })).toHaveCount(setCount);
  });

  test("each-side is hidden for time mode, where it has no meaning", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));

    await expect(page.getByRole("switch", { name: "Reps are per side" })).toBeVisible();
    await page.getByRole("button", { name: "Time" }).click();
    await expect(page.getByRole("switch", { name: "Reps are per side" })).toHaveCount(0);

    // But a weight-relative target still makes sense for a weighted hold.
    await expect(page.getByRole("switch", { name: "Target from last weight" })).toBeVisible();
  });
});
