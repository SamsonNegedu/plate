import { defineConfig, devices } from "@playwright/test";

// Pixel baselines need a fresh server and are macOS renders, so they run only via `pnpm test:visual`.
const appTests = process.env.VISUAL ? [/auth\.setup\.ts/] : [/auth\.setup\.ts/, /visual\.spec\.ts/];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  workers: 1,
  retries: process.env.CI ? 1 : 0, // the fake-camera scan is the one test with rare timing flakes
  use: {
    baseURL: "http://127.0.0.1:18081",
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  projects: [
    {
      name: "setup-mobile-400",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 400, height: 800 } },
    },
    { name: "setup-desktop", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-400",
      testIgnore: appTests,
      dependencies: ["setup-mobile-400"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 400, height: 800 },
        storageState: ".auth/mobile-400.json",
      },
    },
    {
      name: "desktop",
      testIgnore: appTests,
      dependencies: ["setup-desktop"],
      use: { ...devices["Desktop Chrome"], storageState: ".auth/desktop.json" },
    },
  ],
  webServer: {
    command:
      "D=$(mktemp -d) && (if [ -x ../bin/e2eseed ]; then ../bin/e2eseed $D/seed.db; else (cd .. && go run ./tools/e2eseed $D/seed.db); fi) && PLATE_ADDR=127.0.0.1:18081 PLATE_DATA_DIR=$D PLATE_IMPORT_CATALOG_PATH=$D/seed.db PLATE_ADMIN_EMAIL=e2e@example.com PLATE_ADMIN_PASSWORD=e2e-test-passphrase PLATE_OFF_BASE_URL=http://127.0.0.1:1 PLATE_OFF_SEARCH_URL=http://127.0.0.1:1 ../bin/plate",
    url: "http://127.0.0.1:18081/healthz",
    reuseExistingServer: false,
  },
});
