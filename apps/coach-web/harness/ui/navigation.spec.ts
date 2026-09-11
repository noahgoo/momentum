import { DRAFT_DEBOUNCE_MS, test, expect, visit } from "./fixtures";

/**
 * The phone shell, and the guard on leaving unsaved work.
 *
 * Below `lg` the sidebar is an off-canvas drawer and the messages screen is
 * list-then-thread. Both were introduced for phone width and neither is
 * exercised by anything a build can check.
 */

test.describe("mobile shell", () => {
  test.skip(({ isMobile }) => !isMobile, "phone-width layout");

  test("the drawer opens, traps the page, and closes on navigation", async ({ page }) => {
    await visit(page, "/clients");
    await expect(page.locator("aside").first()).toBeHidden();

    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    expect(await drawer.getByRole("link").count()).toBeGreaterThanOrEqual(5);

    // Scroll lock, or the page behind scrolls under the drawer.
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");

    // Every row is a link, so without an explicit close the drawer sits open on
    // top of the page it just navigated to.
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").getByRole("link", { name: /Library/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(page.url()).toContain("/library/");
  });

  test("the section nav scrolls the active tab into view", async ({ page }) => {
    // Library has five children. Landing on a later one used to leave its tab
    // entirely off-screen, with nothing marking where you were.
    await visit(page, "/library/motivation");
    const state = await page.evaluate(() => {
      const nav = document.querySelector("main nav")!;
      const active = nav.querySelector('[aria-current="page"]')!;
      const n = nav.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      return { scrollable: nav.scrollWidth > nav.clientWidth, visible: a.left >= n.left - 1 && a.right <= n.right + 1 };
    });
    expect(state.scrollable).toBe(true);
    expect(state.visible).toBe(true);
  });

  test("messages goes list, thread, back without losing a half-typed reply", async ({ page }) => {
    // The reason both panes stay mounted and are hidden with classes: the
    // composer holds its draft in local state (offline-perf S1).
    await visit(page, "/inbox/messages");
    await page.getByText("Marguerite Okonkwo-Bergstrom").first().click();

    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    await composer.fill("Brace before the unrack —");

    await page.getByRole("button", { name: "Back to conversations" }).click();
    await expect(page.getByText("3 conversations")).toBeVisible();

    await page.getByText("Marguerite Okonkwo-Bergstrom").first().click();
    await expect(composer).toHaveValue("Brace before the unrack —");
  });

  test("the exercise library opens as a sheet and closes on add", async ({ page }) => {
    await visit(page, "/library/workouts/new");
    // The desktop rail is hidden here; the sheet is the only way in.
    await expect(page.getByPlaceholder("Search exercises…")).toBeHidden();

    await page.getByRole("button", { name: "+ Add exercise" }).click();
    const sheet = page.getByRole("dialog", { name: "Exercise library" });
    await expect(sheet).toBeVisible();

    await sheet.getByRole("button", { name: "Add" }).first().click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText("No exercises yet — add some from the library.")).toHaveCount(0);
  });

  test("inputs are at least 16px, or mobile Safari zooms and never zooms back", async ({ page }) => {
    await visit(page, "/library/workouts/new");
    const size = await page
      .locator("input")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});

test.describe("unsaved-changes guard", () => {
  /** On a phone the nav links live inside the drawer, so open it first. */
  async function clickClients(page: import("@playwright/test").Page, isMobile: boolean) {
    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: /Clients/ }).click();
    } else {
      await page.getByRole("link", { name: /Clients/ }).first().click();
    }
  }

  test("prompts on leaving a dirty builder, and staying means staying", async ({ page, isMobile }) => {
    await visit(page, "/library/workouts/new");
    await page.getByPlaceholder("e.g. Upper body strength").fill("Guard Me");
    await page.waitForTimeout(DRAFT_DEBOUNCE_MS);

    let prompted = false;
    page.on("dialog", (d) => {
      prompted = true;
      void d.dismiss();
    });

    await clickClients(page, Boolean(isMobile));
    await page.waitForTimeout(500);

    expect(prompted).toBe(true);
    expect(page.url()).toContain("/library/workouts/new");
  });

  test("does not prompt when nothing has been typed", async ({ page, isMobile }) => {
    await visit(page, "/library/workouts/new");

    let prompted = false;
    page.on("dialog", (d) => {
      prompted = true;
      void d.accept();
    });

    await clickClients(page, Boolean(isMobile));
    await page.waitForTimeout(500);

    expect(prompted).toBe(false);
    expect(page.url()).toContain("/clients");
  });
});
