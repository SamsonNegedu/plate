import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  workers: 1,
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
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup-mobile-400"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 400, height: 800 },
        storageState: ".auth/mobile-400.json",
      },
    },
    {
      name: "desktop",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup-desktop"],
      use: { ...devices["Desktop Chrome"], storageState: ".auth/desktop.json" },
    },
  ],
  webServer: {
    command:
      "D=$(mktemp -d) && (cd .. && go run ./tools/e2eseed $D/seed.db) && PLATE_ADDR=127.0.0.1:18081 PLATE_DATA_DIR=$D PLATE_IMPORT_CATALOG_PATH=$D/seed.db PLATE_ADMIN_EMAIL=e2e@example.com PLATE_ADMIN_PASSWORD=e2e-test-passphrase PLATE_OFF_BASE_URL=http://127.0.0.1:1 PLATE_OFF_SEARCH_URL=http://127.0.0.1:1 ../bin/plate",
    url: "http://127.0.0.1:18081/healthz",
    reuseExistingServer: false,
  },
});
