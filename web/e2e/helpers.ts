import type { Page } from "@playwright/test";

export const EMAIL = "e2e@example.com";
export const PASSWORD = "e2e-test-passphrase";

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** Replace BarcodeDetector with one that "reads" the given code, so the scan flow runs without a real camera or decoder. */
export async function mockDetector(page: Page, code: string): Promise<void> {
  await page.addInitScript((value) => {
    class FakeDetector {
      static getSupportedFormats() {
        return Promise.resolve(["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]);
      }
      detect() {
        return Promise.resolve([{ rawValue: value }]);
      }
    }
    Object.defineProperty(window, "BarcodeDetector", { value: FakeDetector, configurable: true });
  }, code);
}
