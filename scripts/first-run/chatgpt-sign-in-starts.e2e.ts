import { expect } from "e2e";

import { test } from "./first-run.ts";

test("A new owner sets up ChatGPT from the welcome page as far as its sign-in page", async ({
  firstRun,
  app,
  screen,
}) => {
  await firstRun.open();
  await expect(screen.getByText("Welcome to Majordome")).toBeVisible({ timeout: 60_000 });

  await screen.getByRole("button", "Set up: ChatGPT").tap();
  await app.screenshot("card");
  await screen.getByRole("button", "Continue with ChatGPT").tap();
  // The real download of what runs ChatGPT here. The button is drawn greyed out meanwhile, and
  // can be pressed once OpenAI's sign-in page is ready; that page is not driven.
  await expect(screen.getByRole("button", "Open sign-in page")).toBeEnabled({ timeout: 600_000 });
  await app.screenshot("sign-in-started");
});
