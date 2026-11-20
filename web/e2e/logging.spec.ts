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

test("save a meal as a recipe and log a portion of it", async ({ page }) => {
  const date = day("05-01");
  const name = `Desk lunch ${test.info().project.name}`;
  await page.goto(`/today/${date}`);
  await quickAdd(page, "lunch", "Prep bowl", "420");
  await page.goto(`/today/${date}`);

  await page.getByRole("button", { name: /Save as recipe/ }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Makes (portions)").fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`Saved ${name} as a recipe`).first()).toBeVisible();

  await page.getByRole("button", { name: "Add to dinner" }).click();
  await page.getByLabel("Search foods").fill("desk lunch"); // a recipe is found by name like any food
  await page.getByRole("button", { name: `Add ${name} to dinner` }).click();
  await expect(page.getByText("210 kcal a portion")).toBeVisible(); // 420 kcal over 2 portions
  await page.getByRole("button", { name: "Add to dinner" }).click();
  await expect(page.getByText(`Added ${name} to dinner`).first()).toBeVisible();

  await page.goto(`/today/${date}`);
  await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText("Recipe · 1 portion")).toBeVisible();
});

test("build a recipe from a searched ingredient and log a portion", async ({ page }) => {
  const name = `Nutella toast ${test.info().project.name}`;
  await page.goto("/recipes");
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Portions", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Search ingredients" }).click();
  await page.getByLabel("Search foods").fill("nutella");
  await page
    .getByRole("button", { name: /Nutella/ })
    .first()
    .click();
  await page.getByRole("button", { name: "100 g", exact: true }).click();
  await page.getByRole("button", { name: "Add to recipe" }).click();
  await expect(page.getByText("270 kcal a portion")).toBeVisible(); // 539 kcal over 2 portions
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText(`Saved ${name}`).first()).toBeVisible(); // Radix adds a hidden screen-reader copy for a moment

  await page.getByRole("button", { name: `Log ${name}` }).click();
  await page.getByRole("button", { name: "½ portion" }).click();
  await page.getByRole("button", { name: /^Add to / }).click();
  await expect(page.getByText(new RegExp(`Added ${name} to`))).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText("Recipe · ½ portion")).toBeVisible();

  // Save is only live while something has changed
  await page.goto("/recipes");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  const save = page.getByRole("button", { name: "Save recipe" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Portions", { exact: true }).fill("3");
  await expect(save).toBeEnabled();
  await page.getByLabel("Portions", { exact: true }).fill("2");
  await expect(save).toBeDisabled();
});

test("scan an ingredient from the recipe editor and keep what was typed", async ({ page }) => {
  await mockDetector(page, "80177173");
  await page.goto("/recipes/new");
  await page.getByLabel("Name", { exact: true }).fill("Scanned spread");
  await page.getByLabel("Portions", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Scan ingredient" }).click();
  await expect(page.getByRole("dialog", { name: "Nutella" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "100 g", exact: true }).click();
  await page.getByRole("button", { name: "Add to recipe" }).click();
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Scanned spread");
  await expect(page.getByLabel("Portions", { exact: true })).toHaveValue("4");
  await expect(page.getByText("135 kcal a portion")).toBeVisible(); // 539 kcal over 4 portions
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
  await expect(page.getByRole("button", { name: /^Nutella/ }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /^Nutella/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("Search foods").fill("");
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Nutella/ }).first()).toBeVisible();

  await page
    .getByRole("button", { name: /^Nutella/ })
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
  await page.goto("/settings/foods");
  await page.getByRole("button", { name: "Add a food" }).click();
  await page.getByLabel("Name", { exact: true }).fill(oats);
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("380");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: oats })).toBeVisible();
  await page.getByRole("button", { name: /^Add to (breakfast|lunch|dinner|snacks)$/ }).click();
  await expect(page.getByText(/^Added to /)).toBeVisible();
  await expect(page.getByRole("button", { name: oats }).first()).toBeVisible();
  await expect(page.getByText("380 kcal").first()).toBeVisible();

  await page.goto("/settings/foods");
  const item = page.getByRole("listitem").filter({ hasText: oats });
  await item.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("400");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: oats })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/today");
  await expect(page.getByText("380 kcal").first()).toBeVisible();

  await page.goto("/settings/foods");
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

test("track a medication, log a dose from the Today reminder, then weight and appetite", async ({
  page,
}) => {
  await page.goto("/today");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Health" })
    .click();
  await expect(page).toHaveURL(/\/health$/);
  await page.getByRole("button", { name: "Medication", exact: true }).click();
  await page.getByRole("button", { name: "Track a medication" }).click();
  await page.getByRole("combobox", { name: "Medication" }).selectOption("Wegovy");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Wegovy" })).toBeVisible();
  await expect(page.getByText("Due today")).toBeVisible();

  // The reminder on Today stands in for a push notification
  await page.goto("/today");
  await expect(page.getByText("Wegovy dose due today")).toBeVisible();
  await page.getByRole("link", { name: "Log a dose" }).click();
  await expect(page.getByRole("dialog", { name: "Log a dose" })).toBeVisible();
  await page.getByLabel("Dose", { exact: true }).fill("0,25");
  await expect(page.getByRole("button", { name: "0.25 mg" })).toHaveAttribute(
    "aria-pressed",
    "true",
  ); // Wegovy's strengths are shortcuts
  await page.getByLabel("Injection site").selectOption("Right abdomen");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Logged dose 0.25 mg")).toBeVisible();
  const doses = page.getByRole("list", { name: "Recent doses" });
  await expect(doses).toContainText("0.25");
  await expect(doses).toContainText("Right abdomen");
  await expect(page.getByText("In 7 days")).toBeVisible();
  await expect(page.getByText(/Next dose\s*·\s*0\.25 mg/)).toBeVisible(); // the amount rides on the next-dose label

  await page.getByRole("button", { name: "Weight", exact: true }).click();
  await page.getByRole("button", { name: "Log a measurement" }).click();
  await expect(page.getByRole("dialog", { name: "Log a measurement" })).toBeVisible();
  await expect(page.getByLabel("Measure", { exact: true })).toHaveValue("weight"); // weight first, everything else in the same sheet
  await page.getByRole("textbox", { name: "Weight", exact: true }).fill("88,4");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "Weight" })).toContainText("88.4");

  await page.getByRole("button", { name: "Medication", exact: true }).click();
  const appetite = page.getByRole("button", { name: "Appetite 3 of 5, Normal" });
  await appetite.click();
  await expect(appetite).toHaveAttribute("aria-pressed", "true");

  // An impossible dose is refused with a message, not saved
  await page.getByRole("button", { name: "Log a dose" }).click();
  await page.getByLabel("Dose", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Enter the dose in mg, above 0 and up to 100.")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/today");
  await expect(page.getByLabel("Health reminder")).toHaveCount(0); // dose is not due and weight is recent

  // Switching to another pen keeps the earlier doses in the log
  await page.goto("/health/medication");
  await page.getByRole("button", { name: "Change medication" }).click();
  await page.getByRole("combobox", { name: "Medication" }).selectOption("Mounjaro");
  await page.getByRole("button", { name: "Switch medication" }).click();
  await expect(page.getByRole("heading", { name: "Mounjaro" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recent doses" })).toContainText("Wegovy");
});

test("body measurements: one button adds any of them and only the ones used are listed", async ({
  page,
}) => {
  await page.goto("/health/weight");
  await expect(page.getByRole("list", { name: "Body measurements" })).toHaveCount(0);
  await page.getByRole("button", { name: "Log a measurement" }).click();
  await expect(page.getByRole("dialog", { name: "Log a measurement" })).toBeVisible();
  await page.getByLabel("Measure", { exact: true }).selectOption("hips");
  await page.getByRole("textbox", { name: "Hips" }).fill("101,5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const list = page.getByRole("list", { name: "Body measurements" });
  await expect(list).toContainText("Hips");
  await expect(list).toContainText("101.5");
  await expect(list).not.toContainText("Waist");
});

test("the summary leads with calories eaten and meals open their nutrient table", async ({
  page,
}) => {
  const date = day("05-04");
  await page.goto(`/today/${date}`);
  await quickAdd(page, "breakfast", "Table oats", "300");
  await page.goto(`/today/${date}`);
  await quickAdd(page, "lunch", "Table soup", "500");
  await page.goto(`/today/${date}`);

  const summary = page.getByRole("region", { name: "Day summary" });
  await expect(summary).toContainText("800");
  await expect(summary).toContainText("kcal eaten");
  await expect(summary).toContainText(/[\d,]+ left of [\d,]+/); // the goal is whatever this account saved

  // a meal heading opens that meal's table, with its share of the day
  await page.getByRole("button", { name: /Breakfast nutrition/ }).click();
  const sheet = page.getByRole("dialog", { name: "Nutrition" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("row", { name: /Energy/ })).toContainText("300 kcal");
  await expect(sheet.getByRole("row", { name: /Energy/ })).toContainText("38%"); // 300 of 800
  await sheet.getByRole("button", { name: "Day", exact: true }).click();
  await expect(sheet.getByRole("row", { name: /Energy/ })).toContainText("800 kcal");
  await expect(sheet.getByRole("row", { name: /Energy/ })).toContainText(/800 kcal\s*[\d,]+ kcal/);
  await sheet.getByRole("button", { name: "Lunch" }).click();
  await expect(sheet.getByRole("row", { name: /Energy/ })).toContainText("500 kcal");
  await page.getByRole("button", { name: "Close" }).click();

  // the summary opens the same table on the whole day
  await page.getByRole("button", { name: "All nutrients" }).click();
  await expect(page.getByRole("dialog", { name: "Nutrition" })).toContainText("Whole day");
});

test("macro goals: grams or a share of the calories, checked against the calorie goal", async ({
  page,
}) => {
  await page.goto("/settings/goals");
  await page.getByLabel("Daily calories").fill("2000");
  await page.getByLabel("Protein", { exact: true }).fill("150");
  await page.getByLabel("Carbs", { exact: true }).fill("200");
  await page.getByLabel("Fat", { exact: true }).fill("67");
  await page.getByLabel("Fibre", { exact: true }).fill("30");
  await expect(page.getByText("Adds up to 2,003 kcal, which matches your goal.")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Protein 30%, Carbs 40%, Fat 30% of your calories/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "% of calories" }).click();
  await expect(page.getByLabel("Protein", { exact: true })).toHaveValue("30");
  await page.getByLabel("Protein", { exact: true }).fill("35");
  await expect(page.getByText("175 g")).toBeVisible(); // the percentage becomes grams
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(page.getByText("Goals saved").first()).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Protein", { exact: true })).toHaveValue("175");
  await expect(page.getByLabel("Fibre", { exact: true })).toHaveValue("30"); // a goal of its own, not part of the macro calories

  await page.getByLabel("Protein", { exact: true }).fill("20");
  await expect(page.getByText(/under your calorie goal/)).toBeVisible();
});

test("tabs and chart choices are in the address, so they can be linked, reloaded and gone back to", async ({
  page,
}) => {
  await page.goto("/health/insights");
  await expect(page.getByRole("button", { name: "Insights", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The tab control stays where it is while the content under it changes
  const tabY = async () =>
    (await page.getByRole("button", { name: "Insights", exact: true }).boundingBox())?.y;
  const y = await tabY();
  await page.getByRole("button", { name: "Medication", exact: true }).click();
  await expect(page).toHaveURL(/\/health\/medication$/);
  expect(await tabY()).toBe(y);
  await page.getByRole("button", { name: "Weight", exact: true }).click();
  expect(await tabY()).toBe(y);
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  await page.getByRole("button", { name: "Weight", exact: true }).click();
  await expect(page).toHaveURL(/\/health\/weight$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/health\/insights$/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Insights", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto("/history?range=7&metric=protein");
  await expect(page.getByText("Protein, g a day")).toBeVisible(); // the chart says what its axis counts
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Protein", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "30 days" }).click();
  await expect(page).toHaveURL(/range=30/);
  await expect(page).toHaveURL(/metric=protein/);

  // the less common nutrients live in a menu, which then shows the pick
  await page.getByLabel("More nutrients").selectOption("fiber");
  await expect(page).toHaveURL(/metric=fiber/);
  await expect(page.getByLabel("More nutrients")).toHaveValue("fiber");
  await expect(page.getByRole("button", { name: "Protein", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.goto("/recipes/new?tab=nutrition");
  await expect(page.getByRole("button", { name: "Nutrition", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a recipe is shared as a copy: saved as a file, then imported into another account's recipes", async ({
  page,
}) => {
  const name = `Shared toast ${test.info().project.name}`;
  await page.goto("/recipes/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Portions", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Search ingredients" }).click();
  await page.getByLabel("Search foods").fill("nutella");
  await page
    .getByRole("button", { name: /^Nutella/ })
    .first()
    .click();
  await page.getByRole("button", { name: "100 g", exact: true }).click();
  await page.getByRole("button", { name: "Add to recipe" }).click();
  await page.getByRole("button", { name: "Save recipe" }).click();

  // one tap from the list, no need to open the recipe first
  await page.getByRole("button", { name: `Share ${name}` }).click();
  const sheet = page.getByRole("dialog", { name: "Share recipe" });
  await expect(sheet).toContainText("nothing is linked or synced");
  await expect(sheet.getByLabel("What the recipe says")).toContainText("Per portion");
  const download = page.waitForEvent("download");
  await sheet.getByRole("button", { name: "Save as file" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.plate-recipe\.json$/);
  const { readFile } = await import("node:fs/promises");
  const data = await readFile((await file.path()) ?? "", "utf8");
  expect(data).not.toContain("food_id");
  await page.getByRole("button", { name: "Close" }).click();
  // and the same from inside the recipe, in the title row
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Share recipe" }).click();
  await expect(page.getByRole("dialog", { name: "Share recipe" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // The receiving side: paste what was shared, see what it is, add it
  await page.goto("/recipes");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import a recipe" });
  await dialog.getByLabel("Or paste the recipe data").fill("my grandmother's soup");
  await expect(dialog.getByRole("alert")).toContainText("not a Plate recipe");
  await expect(dialog.getByRole("button", { name: "Add to my recipes" })).toBeDisabled();
  await dialog.getByLabel("Or paste the recipe data").fill(data);
  await expect(dialog.getByRole("status")).toContainText("1 ingredient");
  await dialog.getByRole("button", { name: "Add to my recipes" }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
});
