import { expect } from "e2e";

import { test } from "./first-run.ts";

test("A new owner installs Claude from the welcome page and is sent to its sign-in page", async ({
  firstRun,
  app,
  screen,
}) => {
  await firstRun.open();
  await expect(screen.getByText("Hello, I'm Majordome", { exact: false })).toBeVisible({
    timeout: 60_000,
  });

  // The first question is the owner's name, which is optional.
  await screen.getByRole("button", "Skip").tap();

  await screen.getByRole("button", "Install: Claude").tap();
  const signIn = screen.getByRole("button", "Sign in: Claude");
  // The real installer downloads Claude; the button changes once the app finds it.
  await expect(signIn).toBeVisible({ timeout: 300_000 });
  await app.screenshot("installed");

  await signIn.tap();
  await expect(
    screen.getByText("A sign-in page opened in your browser", { exact: false }),
  ).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await firstRun.openedInBrowser()).join("\n"), { timeout: 60_000 })
    .toContain("/oauth/authorize");
  await app.screenshot("sign-in-started");
});
