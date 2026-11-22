import { expect, type Page, test } from "@playwright/test";
import { mockDetector } from "./helpers";

// Pixel baselines at 400 px, light and dark. Only the mobile project runs them; a diff is a design change.
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== "mobile-400", "visual baselines are mobile-only");
});

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect.soft(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    maxDiffPixelRatio: 0.002,
    mask: [page.getByRole("status"), page.locator("video")],
  });
}

async function quickAdd(page: Page, meal: string, name: string, kcal: string) {
  await page.getByRole("button", { name: `Add to ${meal}` }).click();
  await page.getByRole("button", { name: "Quick add calories" }).click();
  await page.getByLabel("Name (optional)").fill(name);
  await page.getByRole("textbox", { name: "Energy in kilocalories", exact: true }).fill(kcal);
  await page.getByRole("button", { name: new RegExp(`Add to ${meal}`) }).click();
  await expect(page.getByText("Added to", { exact: false }).first()).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme, reducedMotion: "reduce" });

    test("signed-out login", async ({ browser }) => {
      const ctx = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        colorScheme: scheme,
        reducedMotion: "reduce",
        viewport: { width: 400, height: 800 },
      });
      const page = await ctx.newPage();
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await shot(page, `login-${scheme}`);
      await ctx.close();
    });

    test("today, sheets, history, settings, scan", async ({ page }) => {
      const DAY = scheme === "light" ? "2026-07-02" : "2026-07-03"; // the server is shared, so each scheme logs on its own day
      await page.goto(`/today/${DAY}`);
      await expect(page.getByText("Nothing logged yet.")).toBeVisible();
      await shot(page, `today-empty-${scheme}`);

      await quickAdd(page, "breakfast", "Oats and berries", "420");
      await page.goto(`/today/${DAY}`);
      await quickAdd(page, "lunch", "Canteen", "640");
      await page.goto(`/today/${DAY}`);
      await expect(page.getByRole("button", { name: /Canteen/ })).toBeVisible();
      await shot(page, `today-entries-${scheme}`);

      await page.getByRole("button", { name: "Add to dinner" }).click();
      await shot(page, `sheet-add-${scheme}`);
      await page.getByLabel("Search foods").fill("nutella");
      await expect(page.getByRole("button", { name: /Nutella/ }).first()).toBeVisible();
      await shot(page, `sheet-search-${scheme}`);
      await page
        .getByRole("button", { name: /Nutella/ })
        .first()
        .click();
      await expect(page.getByRole("dialog", { name: "Nutella" })).toBeVisible();
      await shot(page, `sheet-product-${scheme}`);

      await page.goto("/history");
      await page.waitForLoadState("networkidle");
      await shot(page, `history-${scheme}`);

      await page.goto("/settings");
      await page.waitForLoadState("networkidle");
      await shot(page, `settings-${scheme}`);

      await mockDetector(page, "80177173");
      await page.goto(`/scan?date=${DAY}`);
      await expect(page.getByRole("dialog", { name: "Nutella" })).toBeVisible({ timeout: 15_000 });
      await shot(page, `scan-product-${scheme}`);
    });
  });
}
