import { expect } from "e2e";

import { test } from "./first-run.ts";

// Needs CLAUDE_CODE_OAUTH_TOKEN, from `claude setup-token`: it stands in for the browser sign-in.
// It asks a real model one short question, so it runs nightly and before a release, not per push.
test("A new owner with Claude signed in starts their notes and gets a first answer", async ({
  firstRun,
  app,
  screen,
  browser,
}) => {
  await firstRun.open();
  await expect(screen.getByText("Hello, I'm Majordome", { exact: false })).toBeVisible({
    timeout: 60_000,
  });

  // The first question is the owner's name, which is optional.
  await screen.getByRole("button", "Skip").tap();

  await screen.getByRole("button", "Install: Claude").tap();
  await expect(screen.getByText("Your assistant is ready")).toBeVisible({ timeout: 300_000 });
  await expect(screen.getByRole("button", "Sign in: Claude")).not.toBeVisible();
  await app.screenshot("claude-ready");

  await screen.getByRole("button", "Start new notes").tap();
  await screen.getByRole("button", "Not now, open Today").tap();
  const composer = screen.getByPlaceholder("Ask anything, or tell me what to remember", {
    exact: false,
  });
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await composer.fill("What is 1234 + 4321? Reply with only the number.");
  await browser.keyboard.press("Enter");

  await expect(screen.getByText("5555", { exact: false })).toBeVisible({ timeout: 180_000 });
  await app.screenshot("first-answer");
});
