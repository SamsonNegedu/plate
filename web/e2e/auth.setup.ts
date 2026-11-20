import { test as setup } from "@playwright/test";
import { signUp, usernameFor } from "./helpers";

// One signup per project, saved and reused, so the sign-in rate limit is never in the way.
setup("sign up once", async ({ page }) => {
  await signUp(page, usernameFor(setup.info().project.name.replace("setup-", "")));
  await page
    .context()
    .storageState({ path: `.auth/${setup.info().project.name.replace("setup-", "")}.json` });
});
