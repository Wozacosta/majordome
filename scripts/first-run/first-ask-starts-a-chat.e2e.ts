import { expect } from "e2e";

import { test } from "./first-run.ts";

const ASK = "Help me plan my move to Lisbon";

// Run with FIRST_RUN_REPLAY=1: the free replay assistant is ready, as Claude is once signed in.
test("With an assistant ready, what a new owner wants help with is their first chat", async ({
  firstRun,
  app,
  screen,
}) => {
  await firstRun.open();
  await expect(screen.getByText("Welcome to Majordome")).toBeVisible({ timeout: 60_000 });

  await screen.getByLabel("What should I call you?").fill("Ana Costa");
  await screen.getByLabel("What do you want help with first?").fill(ASK);
  await screen.getByRole("button", "Start new notes").tap();

  // The chat opens with the ask already sent, and the assistant answers it.
  await expect(screen.getByText(ASK)).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText("What this chat knows")).toBeVisible({ timeout: 60_000 });
  await app.screenshot("first-chat");
  expect(await firstRun.note("me.md")).toContain("- Name: Ana Costa\n");

  // The chat says it starts with the note about the owner, and opens it.
  await screen.getByText("About you").tap();
  await expect(screen.getByText("Name: Ana Costa", { exact: false })).toBeVisible();
  await app.screenshot("about-you-note");
});
