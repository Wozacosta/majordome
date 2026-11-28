import { expect } from "e2e";

import { test } from "./first-run.ts";

test("A new owner sets up Gemini from the welcome page as far as Google's sign-in", async ({
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
  // The three are offered before any of them is on the machine.
  await expect(screen.getByRole("button", "Install: Claude")).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole("button", "Set up: ChatGPT")).toBeVisible();
  await app.screenshot("three-offered");

  await screen.getByRole("button", "Set up: Gemini").tap();
  await screen.getByRole("button", "Install: Gemini").tap();
  // The real download; the card moves on to the account once it is on the machine.
  const signIn = screen.getByRole("button", "Sign in: Gemini");
  await expect(signIn).toBeVisible({ timeout: 600_000 });
  await app.screenshot("installed");

  await signIn.tap();
  // Google's page is not driven: the run stops once the link to it and the box for its code show.
  await expect(screen.getByRole("button", "Open Google sign-in")).toBeVisible({ timeout: 120_000 });
  await expect(screen.getByText("2. Paste the code here")).toBeVisible();
  await app.screenshot("sign-in-started");
});
