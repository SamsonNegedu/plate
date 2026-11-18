import { test as setup } from "@playwright/test";
import { login } from "./helpers";

// One sign-in per project, saved and reused: the server allows 5 sign-in attempts a minute from one address.
setup("sign in once", async ({ page }) => {
  await login(page);
  await page
    .context()
    .storageState({ path: `.auth/${setup.info().project.name.replace("setup-", "")}.json` });
});
