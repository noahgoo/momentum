import { test, expect, visit } from "./fixtures";

/**
 * The Add client dialog replaced a disabled stub. It has to fit a phone (the
 * sheet sits at the bottom edge of a 390px viewport) and hand over a password
 * the coach can read, because that password is only shown once.
 */
test.describe("add client dialog", () => {
  test("opens, fits the viewport, and offers a generated password", async ({ page }) => {
    await visit(page, "/clients");
    await page.getByRole("button", { name: "Add client" }).click();

    const dialog = page.getByRole("dialog", { name: "Add client" });
    await expect(dialog).toBeVisible();

    // A password is pre-filled so the coach never has to invent one.
    const password = await dialog.getByLabel("Password").inputValue();
    expect(password.length).toBeGreaterThanOrEqual(8);

    // Generating replaces it.
    await dialog.getByRole("button", { name: "Generate" }).click();
    expect(await dialog.getByLabel("Password").inputValue()).not.toBe(password);

    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x, "dialog starts inside the viewport").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "dialog ends inside the viewport").toBeLessThanOrEqual(viewport.width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "page does not scroll sideways"
    ).toBe(true);
  });

  test("email invites stay off until the mobile build can open the link", async ({ page }) => {
    await visit(page, "/clients");
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByRole("radio", { name: "Email invite" })).toBeDisabled();
  });

  test("Escape closes it", async ({ page }) => {
    await visit(page, "/clients");
    await page.getByRole("button", { name: "Add client" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
