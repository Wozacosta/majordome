import { expect } from "e2e";

import { test } from "./first-run.ts";

const ASK = "Help me plan my move to Lisbon";

// No assistant is installed here, so nothing is sent: what the owner typed has to wait for them.
test("A new owner's name is kept in their notes, and their first ask waits in Today's box", async ({
  firstRun,
  app,
  screen,
}) => {
  await firstRun.open();
  await expect(screen.getByText("Welcome to Majordome")).toBeVisible({ timeout: 60_000 });

  await screen.getByLabel("What should I call you?").fill("Ana Costa");
  await screen.getByLabel("What do you want help with first?").fill(ASK);
  await app.screenshot("who-they-are");
  await screen.getByRole("button", "Start new notes").tap();
  await expect(screen.getByText("Your notes folder is ready")).toBeVisible({ timeout: 60_000 });

  const me = await firstRun.note("me.md");
  expect(me).toContain("## Me\n- Name: Ana Costa\n- Language: ");
  expect(me).toContain("- Time zone: ");
  expect(me).toContain("## Contact\n\n## Work\n\n## Identity documents\n");
  // Majordome asks for the owner here, so the starter instructions name the note, not a command.
  const instructions = await firstRun.note("AGENTS.md");
  expect(instructions).toContain("are in me.md");
  expect(instructions).not.toContain("brain-setup");

  await screen.getByRole("button", "Continue without the assistant").tap();
  const box = screen.getByPlaceholder("Ask anything, or tell me what to remember", {
    exact: false,
  });
  await expect(box).toHaveValue(ASK, { timeout: 60_000 });
  await app.screenshot("ask-waits-in-today");
});
