import { expect, type Page, test } from "@playwright/test";
import { mockDetector } from "./helpers";

// The two projects share one server, so each gets its own year; they would otherwise see each other's entries.
const day = (md: string) => `${test.info().project.name === "desktop" ? 2025 : 2026}-${md}`;

const quickAdd = async (page: Page, meal: string, name: string, kcal: string) => {
  await page.getByRole("button", { name: `Add to ${meal}` }).click();
  await page.getByRole("button", { name: "Quick add calories" }).click();
  await page.getByLabel("Name (optional)").fill(name);
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill(kcal);
  await page.getByRole("button", { name: `Add to ${meal}` }).click();
  await expect(page.getByText(`Added to ${meal}`, { exact: true })).toBeVisible();
};

test("save a meal from a day and log it again in one tap", async ({ page }) => {
  const date = day("05-01");
  await page.goto(`/today/${date}`);
  await quickAdd(page, "lunch", "Prep bowl", "420");
  await page.goto(`/today/${date}`);

  await page.getByRole("button", { name: /Save as meal/ }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Desk lunch ${test.info().project.name}`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`Saved Desk lunch ${test.info().project.name}`)).toBeVisible();

  await page.getByRole("button", { name: "Add to dinner" }).click();
  await page
    .getByRole("button", { name: `Add Desk lunch ${test.info().project.name} to dinner` })
    .click();
  await expect(
    page.getByText(`Added Desk lunch ${test.info().project.name} to dinner`),
  ).toBeVisible();

  await page.goto(`/today/${date}`);
  await expect(page.getByRole("button", { name: /Prep bowl/ })).toHaveCount(2);
});

test("editing an entry changes the amount and deleting offers Undo", async ({ page }) => {
  const date = day("05-02");
  await page.goto(`/today/${date}`);
  await quickAdd(page, "lunch", "Editable lunch", "300");
  await page.goto(`/today/${date}`);

  await page.getByRole("button", { name: /Editable lunch/ }).click();
  await page.getByLabel("Amount").fill("0.5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("150 kcal").first()).toBeVisible();

  await page.getByRole("button", { name: /Editable lunch/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: /Editable lunch/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /Editable lunch/ })).toBeVisible();
});

test("a favorite is pinned above search results and can be removed", async ({ page }) => {
  await page.goto(`/today/${day("05-03")}`);
  await page.getByRole("button", { name: "Search by name" }).click();
  await page.getByLabel("Search foods").fill("nutella");
  await expect(page.getByRole("button", { name: /Nutella/ }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /Nutella/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("Search foods").fill("");
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Nutella/ }).first()).toBeVisible();

  await page
    .getByRole("button", { name: /Nutella/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Remove from favorites" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Favorites" })).toHaveCount(0);
});

test("a custom food can be logged, corrected and deleted without rewriting the entry", async ({
  page,
}, testInfo) => {
  const oats = `Test oats ${testInfo.project.name}`;
  await page.goto("/settings");
  await page.getByRole("button", { name: "Add a food" }).click();
  await page.getByLabel("Name", { exact: true }).fill(oats);
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("380");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: oats })).toBeVisible();
  await page.getByRole("button", { name: /^Add to (breakfast|lunch|dinner|snacks)$/ }).click();
  await expect(page.getByText(/^Added to /)).toBeVisible();
  await expect(page.getByRole("button", { name: oats }).first()).toBeVisible();
  await expect(page.getByText("380 kcal").first()).toBeVisible();

  await page.goto("/settings");
  const item = page.getByRole("listitem").filter({ hasText: oats });
  await item.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("400");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: oats })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/today");
  await expect(page.getByText("380 kcal").first()).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: `Delete ${oats}` }).click();
  await expect(page.getByRole("button", { name: `Delete ${oats}` })).toHaveCount(0);
  await page.goto("/today");
  await expect(page.getByRole("button", { name: oats }).first()).toBeVisible();
});

test("a scan is announced and silent mode suppresses the feedback", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as Window & { __vibrations?: number };
    w.__vibrations = 0;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: () => {
        w.__vibrations = (w.__vibrations ?? 0) + 1;
        return true;
      },
    });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Silent" }).click();
  await expect(page.getByRole("button", { name: "Silent" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await mockDetector(page, "80177173");
  await page.goto(`/scan?date=${day("05-05")}`);
  await expect(page.getByRole("dialog", { name: "Nutella" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Barcode found")).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { __vibrations?: number }).__vibrations),
  ).toBe(0);

  await page.getByRole("button", { name: "Close" }).click();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sound and vibration" }).click();
  await expect(page.getByRole("button", { name: "Sound and vibration" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goto(`/scan?date=${day("05-06")}`);
  await expect(page.getByRole("dialog", { name: "Nutella" })).toBeVisible({ timeout: 15_000 });
  expect(
    await page.evaluate(() => (window as Window & { __vibrations?: number }).__vibrations),
  ).toBeGreaterThan(0);
});

test("a product without calories opens manual entry, not a zero-calorie Add", async ({ page }) => {
  const code = "9999999999991";
  await page.route(`**/api/v1/foods/barcode/${code}`, (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/problem+json",
      body: JSON.stringify({
        code: "not_loggable",
        reason: "no_nutrition",
        can_add_manually: true,
        product: { name: "Mystery drink" },
      }),
    }),
  );
  await mockDetector(page, code);
  await page.goto(`/scan?date=${day("05-07")}`);
  const dialog = page.getByRole("dialog", { name: "Add a food" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.getByText("This product has no calorie data, so it cannot be added as it is."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add to / })).toHaveCount(0);
});
