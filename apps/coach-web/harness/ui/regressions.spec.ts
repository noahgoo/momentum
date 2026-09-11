import { DRAFT_DEBOUNCE_MS, test, expect, visit } from "./fixtures";

/**
 * Checks for the review findings on this branch. Each one failed against the
 * code as first written — a test that has never been seen red proves nothing,
 * which is the lesson that produced the delayed `workoutDetail` in fixtures.ts.
 */

const NAME = "e.g. Upper body strength";
const DRAFT_PREFIX = "momentum.draft:";

test.describe("drag sensors", () => {
  test.skip(({ isMobile }) => isMobile, "mouse drag");

  test("a mouse drag past the threshold still reorders", async ({ page }) => {
    // Guards the swap from `PointerSensor` to `MouseSensor` + `TouchSensor`.
    // `PointerSensor` made the touch sensor dead code — `pointerdown` precedes
    // `touchstart`, and dnd-kit stops at the first sensor to claim the gesture
    // (`activeRef.current !== null` in DndContext) — so touch silently kept a
    // 5px distance constraint and any swipe from the grip reordered instead of
    // scrolling. That part is established from dnd-kit's source, not from here:
    // driving a real touch drag proved too coordinate-fragile to assert on
    // honestly, and a check that cannot fail is worse than none. What this does
    // cover is the regression the swap could have caused, which is desktop drag
    // no longer working at all.
    await visit(page, "/library/workouts/new");
    page.on("dialog", (d) => d.accept());

    for (const i of [0, 1]) {
      await page.getByRole("button", { name: "Add" }).nth(i).click();
    }
    await page.waitForTimeout(300);

    const order = () => page.getByLabel("Drag to reorder").locator("xpath=../..").allInnerTexts();
    const before = (await order()).join("|");
    expect(before).toContain("Barbell Bench Press");

    const first = (await page.getByLabel("Drag to reorder").nth(0).boundingBox())!;
    const second = (await page.getByLabel("Drag to reorder").nth(1).boundingBox())!;
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width / 2, second.y + second.height + 20, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect((await order()).join("|"), "mouse drag must still reorder").not.toBe(before);
  });
});

test.describe("library sheet focus", () => {
  test.skip(({ isMobile }) => !isMobile, "the sheet only exists below lg");

  test("typing in the sheet survives a parent re-render", async ({ page }) => {
    // MobileSheet's effect listed `onClose` in its deps and the builder passed
    // an inline arrow, so any parent render tore the effect down and re-ran it,
    // moving focus to the opener and back to the panel mid-word.
    await visit(page, "/library/workouts/new");
    page.on("dialog", (d) => d.accept());

    await page.getByRole("button", { name: "+ Add exercise" }).click();
    // The desktop rail is still mounted (hidden), so this must be scoped to the
    // sheet or it matches two fields.
    const search = page
      .getByRole("dialog", { name: "Exercise library" })
      .getByPlaceholder("Search exercises…");
    await search.click();
    await search.fill("Bar");

    // Force a render of the builder itself, not of the panel, by touching a
    // query it reads. A window "focus" event does not do it — the harness turns
    // refetch-on-focus off — and a check that never triggers a re-render passes
    // against the bug, which is what the first version of this did.
    await page.evaluate(() => {
      const qc = (
        window as unknown as {
          __harnessQueryClient: {
            setQueryData: (key: unknown[], value: unknown) => void;
          };
        }
      ).__harnessQueryClient;
      // Genuinely different data. React Query's structural sharing returns the
      // previous object when the new value is deeply equal, so re-spreading the
      // same array updates nothing and re-renders nothing — which is why the
      // first version of this check passed against the bug.
      qc.setQueryData(
        ["workouts", "warmups"],
        [{ id: `w-${Date.now()}`, name: "Forced re-render", type: "warmup" }]
      );
    });
    await page.waitForTimeout(400);

    await expect(search).toBeFocused();
    await expect(search).toHaveValue("Bar");
  });
});

test.describe("nav drawer", () => {
  test.skip(({ isMobile }) => !isMobile, "phone-width layout");

  test("closes when the row for the current route is tapped", async ({ page }) => {
    // It closed on a `pathname` change, so tapping the row for the page you are
    // already on left it open over that page.
    await visit(page, "/clients");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();

    await drawer.getByRole("link", { name: /Clients/ }).click();
    await expect(drawer).toHaveCount(0);
    expect(page.url()).toContain("/clients");
  });
});

test.describe("drafts and sign-out", () => {
  test("signing out warns, then removes this coach's drafts", async ({ page, isMobile }) => {
    // Drafts are the only coach-web data that outlives a session, so sign-out
    // is the only thing that can stop a half-written program being readable on
    // a shared machine.
    await visit(page, "/library/workouts/new");
    page.on("dialog", (d) => d.accept());
    await page.getByPlaceholder(NAME).fill("Private Programming");
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);

    const count = async () =>
      page.evaluate(
        (p) => Object.keys(localStorage).filter((k) => k.startsWith(p)).length,
        DRAFT_PREFIX
      );
    expect(await count(), "a draft should exist before signing out").toBeGreaterThan(0);

    let warned = false;
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => {
      warned = true;
      void d.accept();
    });

    if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForTimeout(500);

    expect(warned, "sign-out must warn before discarding a draft").toBe(true);
    expect(await count(), "sign-out must leave no draft behind").toBe(0);
  });
});

test.describe("draft validation", () => {
  test("a malformed draft is dropped, not applied", async ({ page }) => {
    // Storage is not trusted input: the draft is spread into state and its
    // exercises reach the save RPC. A bad shape used to crash the render.
    await visit(page, "/library/workouts");
    await page.evaluate((p) => {
      localStorage.setItem(
        `${p}coach-1:workout:new`,
        JSON.stringify({ savedAt: Date.now(), drafts: { name: 42, exercises: "not an array" } })
      );
    }, DRAFT_PREFIX);

    await visit(page, "/library/workouts/new");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("");
    await expect(page.getByText("Restored your unsaved progress")).toHaveCount(0);
  });

  test("a draft that is not an object at all is dropped", async ({ page }) => {
    await visit(page, "/library/workouts");
    await page.evaluate((p) => {
      localStorage.setItem(`${p}coach-1:workout:new`, '"just a string"');
    }, DRAFT_PREFIX);

    await visit(page, "/library/workouts/new");
    await expect(page.getByPlaceholder(NAME)).toHaveValue("");
  });
});
