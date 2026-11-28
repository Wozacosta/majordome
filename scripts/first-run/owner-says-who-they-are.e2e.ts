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
  await expect(screen.getByText("Hello, I'm Majordome", { exact: false })).toBeVisible({
    timeout: 60_000,
  });

  await screen.getByLabel("What should I call you?").fill("Ana Costa");
  await screen.getByRole("button", "Continue").tap();
  await app.screenshot("who-they-are");
  await screen.getByRole("button", "Continue without the assistant").tap();
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

  await screen.getByLabel("What do you want help with first?").fill(ASK);
  await screen.getByRole("button", "Send").tap();
  const box = screen.getByPlaceholder("Ask anything, or tell me what to remember", {
    exact: false,
  });
  await expect(box).toHaveValue(ASK, { timeout: 60_000 });
  await app.screenshot("ask-waits-in-today");

  // New notes welcome their owner on Today, by the name just given, and say how Majordome works.
  const welcome = screen.getByRole("region", "Welcome");
  await expect(welcome.getByText("Welcome, Ana Costa. Tell me anything")).toBeVisible();
  await welcome.getByRole("button", "Skip").tap();
  await expect(welcome).toBeHidden();
  await expect.poll(() => firstRun.note(".majordome/config.json")).not.toContain("welcome");
});
