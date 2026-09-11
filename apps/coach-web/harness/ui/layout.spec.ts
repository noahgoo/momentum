import { ROUTES, test, expect, visit } from "./fixtures";

/**
 * The portal is desktop-first but has to stay usable on a phone, and the way
 * that breaks is silent: something overflows sideways and the right-hand edge
 * of the screen is simply unreachable. Nothing about it fails a build.
 *
 * The naive check — `documentElement.scrollWidth > innerWidth` — does not work
 * here. `main` is `overflow-y-auto`, which computes `overflow-x` to `auto` too,
 * so it becomes its own scroll container and anything overflowing inside it is
 * invisible at the document level. This walks every scroll container instead.
 */
test.describe("layout", () => {
  for (const [path, name] of ROUTES) {
    test(`${name} has no unintended horizontal overflow`, async ({ page }) => {
      await visit(page, path);

      const offenders = await page.evaluate(() => {
        // Two things overflow on purpose: strips that scroll sideways (the
        // section sub-nav, wide tables) and `truncate`, which is
        // overflow:hidden plus an ellipsis by design.
        const INTENTIONAL = ["no-scrollbar", "overflow-x-auto"];
        const bad: string[] = [];

        for (const el of [document.documentElement, ...document.querySelectorAll("*")]) {
          if (el.scrollWidth <= el.clientWidth + 1) continue;
          if (INTENTIONAL.some((c) => String(el.className).includes(c))) continue;

          const cs = getComputedStyle(el);
          // Visible overflow neither clips nor scrolls — that is the section
          // nav's deliberate bleed into main's padding, not a defect.
          if (el !== document.documentElement && cs.overflowX === "visible") continue;
          if (cs.textOverflow === "ellipsis") continue;

          bad.push(
            `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}"> ` +
              `scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`
          );
        }
        return bad.slice(0, 5);
      });

      expect(offenders, `${name} clips or scrolls sideways`).toEqual([]);
    });
  }
});
