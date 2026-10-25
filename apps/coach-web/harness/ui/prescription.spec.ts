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

  test("each-side carries into time mode, as a per-side hold", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));

    const repsSide = page.getByRole("switch", { name: "Reps are per side" });
    await repsSide.click();
    await page.getByRole("button", { name: "Time" }).click();

    // "30s each side" is a real prescription (side plank), so the flag
    // survives the mode change and the time-mode switch reflects it.
    await expect(repsSide).toHaveCount(0);
    const timeSide = page.getByRole("switch", { name: "Time is per side" });
    await expect(timeSide).toHaveAttribute("aria-checked", "true");

    // But a weight-relative target still makes sense for a weighted hold.
    await expect(page.getByRole("switch", { name: "Target from last weight" })).toBeVisible();
  });

  test("load type says what the weight means and applies to every set", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));
    await page.getByRole("button", { name: "+ Add set" }).click();

    await page.getByRole("combobox", { name: "Weight means" }).selectOption("each_hand");

    // The collapsed summary reads off every config; "each hand" there means
    // the value reached the sets, not only set 1.
    await page.getByRole("button", { name: "Close" }).first().click();
    await expect(page.getByText("each hand").first()).toBeVisible();
  });

  test("bodyweight replaces the weight input with a chip", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));
    const weight = page.getByPlaceholder("-").first();
    await weight.fill("25");
    // NumericInput commits on blur, and selectOption does not move focus the
    // way a real click on the select does.
    await weight.blur();

    await page.getByRole("combobox", { name: "Weight means" }).selectOption("bodyweight");
    await expect(page.getByPlaceholder("-")).toHaveCount(0);
    // A <span>, not the <option> of the same name in the select.
    await expect(page.locator("span", { hasText: /^Bodyweight$/ }).first()).toBeVisible();

    // Lossless, like the increment toggle: switching back restores the number.
    await page.getByRole("combobox", { name: "Weight means" }).selectOption("total");
    await expect(page.getByPlaceholder("-").first()).toHaveValue("25");
  });

  test("max effort swaps the target input for a Max chip and restores it", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));
    const reps = page.getByPlaceholder("10").first();
    await reps.fill("12");

    const max = page.getByRole("switch", { name: "Max effort" });
    await max.click();
    await expect(page.getByText("Max", { exact: true }).first()).toBeVisible();
    await expect(page.getByPlaceholder("10")).toHaveCount(0);

    await max.click();
    await expect(page.getByPlaceholder("10").first()).toHaveValue("12");
  });

  test("distance exercises are measured in the chosen unit", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));
    await page.getByRole("button", { name: "Distance" }).click();

    await expect(page.getByText("PACE / MI")).toBeVisible();
    await page.getByRole("button", { name: "km", exact: true }).click();
    await expect(page.getByText("PACE / KM")).toBeVisible();
    await expect(page.getByText("MILES")).toHaveCount(0);
  });

  test("switch knobs sit inside their track, off at the left and on at the right", async ({ page, isMobile }) => {
    await addAndExpandExercise(page, Boolean(isMobile));
    const sw = page.getByRole("switch", { name: "Max effort" });
    const box = async () => {
      const track = (await sw.boundingBox())!;
      const knob = (await sw.locator("span").boundingBox())!;
      return { track, knob };
    };

    // An absolutely positioned knob with no `left` starts at the button's
    // centre, which put it on the wrong side and then out past the track.
    let { track, knob } = await box();
    expect(knob.x).toBeGreaterThanOrEqual(track.x);
    expect(knob.x + knob.width).toBeLessThan(track.x + track.width / 2 + knob.width / 2);

    await sw.click();
    // The knob slides (transition-transform), so wait for it to land.
    await expect
      .poll(async () => {
        ({ track, knob } = await box());
        return knob.x > track.x + track.width / 2 - knob.width;
      })
      .toBe(true);
    expect(knob.x + knob.width).toBeLessThanOrEqual(track.x + track.width);
  });
});
