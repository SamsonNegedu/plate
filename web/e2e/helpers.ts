import type { Page } from "@playwright/test";

export const PASSWORD = "e2e-test-passphrase";

/** Each project signs up as its own account, so two projects can share one server without sharing data. */
export const usernameFor = (project: string) => `e2e-${project}`;

/** Creates the account through the real signup screen and returns the recovery codes it showed. */
export async function signUp(page: Page, username: string, password = PASSWORD): Promise<string[]> {
  await page.goto("/signup");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  const list = page.getByRole("list", { name: "Recovery codes" });
  await list.waitFor();
  const codes = await list.getByRole("listitem").allInnerTexts();
  await page.getByLabel("I have saved these codes").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/today");
  return codes;
}

export async function login(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
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
