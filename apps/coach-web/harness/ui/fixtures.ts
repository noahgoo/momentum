import { test as base, type Page } from "@playwright/test";

/**
 * Shared setup for every UI check.
 *
 * Outbound requests are blocked because the harness needs no network and a
 * hanging font request stalls navigation for the full timeout.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page, baseURL }, use) => {
    await page.route("**/*", (route) =>
      route.request().url().startsWith(baseURL!) ? route.continue() : route.abort()
    );
    await use(page);
  },
});

export { expect } from "@playwright/test";

/** Every route the checks visit, with a name for screenshots and failure output. */
export const ROUTES: [path: string, name: string][] = [
  ["/", "dashboard"],
  ["/clients", "clients"],
  ["/clients/client-0", "client-detail"],
  ["/library/workouts", "workouts"],
  ["/library/warmups", "warmups"],
  ["/library/programs", "programs"],
  ["/library/exercises", "exercises"],
  ["/library/motivation", "motivation"],
  ["/library/workouts/new", "workout-builder-new"],
  ["/library/workouts/w-1", "workout-builder-edit"],
  ["/library/programs/new", "program-builder"],
  ["/inbox/messages", "messages"],
  ["/inbox/requests", "requests"],
  ["/inbox/broadcast", "broadcast"],
  ["/assign", "assign"],
  ["/settings", "settings"],
];

/** Navigate and let the page settle. `networkidle` never fires — reads hang by design. */
export async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
}

/** Longer than the draft hook's 500ms write debounce. */
export const DRAFT_DEBOUNCE_MS = 900;

/**
 * Add the first library exercise to the open workout builder.
 *
 * The route in differs by width, which is the whole point of the mobile work:
 * at `lg` and up the library is a permanent rail, and below it the rail is
 * hidden and the same panel opens as a bottom sheet.
 */
export async function addFirstExercise(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "+ Add exercise" }).click();
    const sheet = page.getByRole("dialog", { name: "Exercise library" });
    await sheet.getByRole("button", { name: "Add" }).first().click();
  } else {
    await page.getByRole("button", { name: "Add" }).first().click();
  }
}
