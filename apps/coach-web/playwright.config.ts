import { defineConfig, devices } from "@playwright/test";

/**
 * Sandboxes and CI images often ship a pre-provisioned Chromium that does not
 * match the build this Playwright version would download. Point at it with
 * PLAYWRIGHT_CHROMIUM_PATH rather than fetching a second copy. Unset locally,
 * where `npx playwright install chromium` is the normal setup.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

/**
 * UI checks for the coach portal, run against the harness (see harness/README.md).
 *
 * `webServer` boots the harness itself, so `pnpm -F coach-web test:ui` is the
 * whole command — nothing to start by hand.
 *
 * Two projects, because most of what these catch is width-dependent: the
 * desktop layout with its permanent sidebar, and a phone where the sidebar is a
 * drawer and 390px is all there is.
 */
export default defineConfig({
  testDir: "./harness/ui",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: "http://localhost:5199",
    trace: "retain-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: {
        ...devices["iPhone 13"],
        // That descriptor defaults to WebKit. Chromium keeps this to a single
        // browser download, and what these checks measure — layout, storage,
        // focus — does not depend on the engine. The one Safari-specific rule
        // covered here (inputs at 16px, or the viewport zooms on focus) is
        // asserted as a computed font size, which Chromium reports the same.
        browserName: "chromium",
      },
    },
  ],
  webServer: {
    command: "npx vite --config vite.harness.config.ts",
    port: 5199,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
