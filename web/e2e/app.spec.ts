import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { EMAIL, mockDetector, PASSWORD } from "./helpers";

// The two projects share one server, so each gets its own year; they would otherwise see each other's entries.
const day = (md: string) => `${test.info().project.name === "desktop" ? 2025 : 2026}-${md}`;

// Each test works on its own date so the shared server never mixes their entries. Tests reuse one saved session because
// the server limits sign-in attempts to 5 a minute per address; the two sign-in tests below start signed out.

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page: _page }, info) => {
    test.skip(
      info.project.name !== "mobile-400",
      "sign-in attempts are rate limited; one project is enough",
    );
  });

  test("signing in: wrong password shows an inline error, the right one opens Today", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your email.")).toBeVisible();
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Email or password is incorrect." }),
    ).toBeVisible();
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  });

  test("an unauthenticated visit goes to the login screen and returns after signing in", async ({
    page,
  }) => {
    await page.goto("/history");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/history$/);
  });
});

test("quick add logs calories and the day total updates", async ({ page }) => {
  await page.goto(`/today/${day("02-01")}`);
  await expect(page.getByText("Nothing logged yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add to lunch" }).click();
  await page.getByRole("button", { name: "Quick add calories" }).click();
  await page.getByLabel("Name (optional)").fill("Canteen");
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("640");
  await page.getByRole("button", { name: /Add to lunch/ }).click();
  await expect(page.getByText("Added to lunch", { exact: true })).toBeVisible();
  await page.goto(`/today/${day("02-01")}`);
  await expect(page.getByRole("button", { name: /Canteen/ })).toBeVisible();
  await expect(page.getByText("640 kcal").first()).toBeVisible();
});

test("search finds a catalog food and logs 30 g without any manual step", async ({ page }) => {
  await page.goto(`/today/${day("02-02")}`);
  await page.getByRole("button", { name: "Add to breakfast" }).click();
  await page.getByLabel("Search foods").fill("nutella");
  await page.getByRole("button", { name: /Nutella/ }).click();
  await page.getByRole("button", { name: "g", exact: true }).click();
  await page.getByRole("textbox", { name: "Amount" }).fill("30");
  await expect(page.getByText("162").first()).toBeVisible();
  await page.getByRole("button", { name: "Add to breakfast" }).click();
  await expect(page.getByText("Added to breakfast", { exact: true })).toBeVisible();
  await page.goto(`/today/${day("02-02")}`);
  await expect(page.getByRole("button", { name: /Nutella Ferrero/ })).toBeVisible();
});

test("a German compound is found by its tail", async ({ page }) => {
  await page.goto(`/today/${day("02-04")}`);
  await page.getByRole("button", { name: "Add to snacks" }).click();
  await page.getByLabel("Search foods").fill("brot");
  await expect(page.getByRole("button", { name: /Vollkornbrot/ })).toBeVisible();
});

test("scanning reads a barcode, opens the product, and adding returns to Today", async ({
  page,
}) => {
  await mockDetector(page, "80177173");
  await page.goto(`/scan?date=${day("02-03")}`);
  await expect(page.getByRole("dialog", { name: "Nutella" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Add to (breakfast|lunch|dinner|snacks)$/ }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText(/^Added to /)).toBeVisible();
});

test("an unknown barcode never dead-ends: the manual sheet opens with the barcode filled in", async ({
  page,
}) => {
  // The food it creates syncs to the shared server, so each project scans its own barcode and names its own food.
  const desktop = test.info().project.name === "desktop";
  const code = desktop ? "4999999999994" : "4999999999993";
  const name = desktop ? "Test Müsli D" : "Test Müsli";
  await mockDetector(page, code);
  await page.goto(`/scan?date=${day("02-05")}`);
  await expect(page.getByRole("dialog", { name: "Add a food" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Barcode")).toHaveValue(code);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("380");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name })).toBeVisible();
  await page.getByRole("button", { name: /^Add to (breakfast|lunch|dinner|snacks)$/ }).click();
  await expect(page).toHaveURL(/\/today$/);
});

test("search with no match offers the manual route", async ({ page }) => {
  await page.goto(`/today/${day("02-06")}`);
  await page.getByRole("button", { name: "Add to dinner" }).click();
  await page.getByLabel("Search foods").fill("zzzqqqxx");
  await expect(page.getByText("No match. Try the barcode or add it manually.")).toBeVisible();
  await page.getByRole("button", { name: "Add a food manually" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("zzzqqqxx");
});

test("logging works offline, shows pending, and syncs when the connection returns", async ({
  page,
  context,
}) => {
  await page.goto(`/today/${day("02-07")}`);
  await expect(page.getByText(/Synced|Not synced yet/)).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // controlled by the worker, so the offline navigation below can be served
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add to lunch" }).click();
  await page.getByRole("button", { name: "Quick add calories" }).click();
  await page.getByLabel("Name (optional)").fill("Offline lunch");
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("500");
  await page.getByRole("button", { name: /Add to lunch/ }).click();
  await expect(page.getByText("Added to lunch", { exact: true })).toBeVisible();
  await page.goto(`/today/${day("02-07")}`).catch(() => undefined);
  await expect(page.getByRole("button", { name: /Offline lunch/ })).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Offline|Pending/ })
      .first(),
  ).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("status").filter({ hasText: /^Synced/ })).toBeVisible({
    timeout: 20_000,
  });
  const res = await page.request.get(`/api/v1/days/${day("02-07")}`);
  expect(await res.text()).toContain("Offline lunch");
});

test("deleting an entry offers Undo, and Undo brings it back", async ({ page }) => {
  await page.goto(`/today/${day("02-08")}`);
  await page.getByRole("button", { name: "Add to lunch" }).click();
  await page.getByRole("button", { name: "Quick add calories" }).click();
  await page.getByLabel("Name (optional)").fill("Doomed lunch");
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("300");
  await page.getByRole("button", { name: /Add to lunch/ }).click();
  await expect(page.getByText("Added to lunch", { exact: true })).toBeVisible();
  await page.goto(`/today/${day("02-08")}`);
  await page.getByRole("button", { name: /Doomed lunch/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: /Doomed lunch/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /Doomed lunch/ })).toBeVisible();
});

test("history shows the chart, its table alternative and the day list", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByRole("group", { name: /Calories per day/ })).toBeVisible();
  await page.getByRole("button", { name: "Show table" }).click();
  await expect(page.getByRole("columnheader", { name: "Protein" })).toBeVisible();
  await page.getByRole("button", { name: "30 days" }).click();
  await expect(page.getByText(/Logged \d+ of 30 days/)).toBeVisible();
});

test("settings: goals save, the theme applies and persists", async ({ page }) => {
  await page.goto("/settings");
  const goal = test.info().project.name === "desktop" ? "2400" : "2300"; // the server is shared, so each project saves its own value
  await page.getByLabel("Daily calories").fill(goal);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(page.getByText("Goals saved").first()).toBeVisible(); // Radix adds a hidden screen-reader copy for a moment
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Auto" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("no horizontal scroll at 400 px on the main screens", async ({ page }) => {
  // Measured against the configured viewport: on mobile, wide content grows window.innerWidth and hides the overflow.
  const width = page.viewportSize()?.width ?? 0;
  for (const path of ["/today", "/history", "/settings", "/scan"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, path).toBeLessThanOrEqual(width);
  }
});

for (const path of ["/login", "/today/2026-03-01", "/settings", "/history"]) {
  test(`axe finds no serious violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
}

test("no console errors or failed requests while using the app", async ({ page }) => {
  const problems: string[] = [];
  const imageProxy = "/api/v1/images/"; // OFF is unreachable in this setup, so thumbnails 502 by design
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("502")) problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page: ${e.message}`));
  page.on("requestfailed", (r) => {
    if (!r.url().includes(imageProxy)) problems.push(`request: ${r.url()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500 && !r.url().includes(imageProxy)) {
      problems.push(`status ${r.status()}: ${r.url()}`);
    }
  });
  await page.goto(`/today/${day("04-01")}`);
  await page.getByRole("button", { name: "Add to lunch" }).click();
  await page.getByLabel("Search foods").fill("nutella");
  await page.getByRole("button", { name: /Nutella/ }).click();
  await page.getByRole("button", { name: /^Add to (breakfast|lunch|dinner|snacks)$/ }).click();
  await expect(page.getByText(/^Added to /)).toBeVisible();
  for (const path of ["/history", "/settings", "/scan"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(problems).toEqual([]);
});

test("the app opens offline after the first load, and offline entries survive an offline reload", async ({
  page,
  context,
}) => {
  await page.goto(`/today/${day("04-10")}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // the page is now controlled by the worker
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day$|^Today$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add to lunch" }).click();
  await page.getByRole("button", { name: "Quick add calories" }).click();
  await page.getByLabel("Name (optional)").fill("Basement lunch");
  await page.getByRole("textbox", { name: "Calories", exact: true }).fill("450");
  await page.getByRole("button", { name: /Add to lunch/ }).click();
  await expect(page.getByText("Added to lunch", { exact: true })).toBeVisible();
  await page.goto(`/today/${day("04-10")}`);
  await expect(page.getByRole("button", { name: /Basement lunch/ })).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Offline|Pending/ })
      .first(),
  ).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("status").filter({ hasText: /^Synced/ })).toBeVisible({
    timeout: 20_000,
  });
  const res = await page.request.get(`/api/v1/days/${day("04-10")}`);
  expect(await res.text()).toContain("Basement lunch");
});

test("the manifest and icons are served for installation", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.headers()["content-type"]).toContain("manifest+json");
  const m = await res.json();
  expect(m).toMatchObject({ name: "Plate", display: "standalone", start_url: "/today" });
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const icon of m.icons as Array<{ src: string }>)
    expect((await request.get(icon.src)).ok()).toBe(true);
});

test("API responses are never cached by the service worker", async ({ page }) => {
  await page.goto("/settings");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  const cached = await page.evaluate(async () => {
    const keys: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys())
        if (new URL(req.url).pathname.startsWith("/api/") && !req.url.includes("/images/"))
          keys.push(req.url);
    }
    return keys;
  });
  expect(cached).toEqual([]);
});
