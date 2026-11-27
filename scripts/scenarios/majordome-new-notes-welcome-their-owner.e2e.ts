import { expect } from "e2e";

import { files, NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "New notes welcome their owner on Today: a name, three cards, and never again",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      // What a notes folder holds from the day it is started until its owner is welcomed.
      ".majordome/config.json": '{ "welcome": "pending" }\n',
    });
    await t3.open("/");

    const welcome = screen.getByRole("region", "Welcome");
    // The first page of a run can take longer than an ordinary check allows.
    await expect(welcome.getByText("What should I call you?", { exact: false })).toBeVisible({
      timeout: 60_000,
    });
    await app.screenshot("asks-the-name");
    await welcome.getByLabel("Welcome. What should I call you?").fill("Ana");
    await welcome.getByRole("button", "Next").tap();

    await expect(welcome.getByText("Tell me anything")).toBeVisible();
    await app.screenshot("first-card");
    await welcome.getByRole("button", "Next").tap();
    await expect(welcome.getByText("Topics for what goes on")).toBeVisible();
    await welcome.getByRole("button", "Next").tap();
    await expect(welcome.getByText("I work while you're away")).toBeVisible();
    await welcome.getByRole("button", "Got it").tap();
    await expect(welcome).toBeHidden();

    // The name is in the note about them, and the folder no longer asks for the welcome.
    await expect
      .poll(() => files.read(`${notes}/me.md`).catch(() => ""))
      .toContain("- Name: Ana\n");
    expect(await files.read(`${notes}/.majordome/config.json`)).not.toContain("welcome");
    await t3.open("/");
    await expect(screen.getByText("Good", { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole("region", "Welcome")).toBeHidden();
    await app.screenshot("welcomed");
  },
);

test("Notes that were never new to this version show no welcome", WEB, async ({ t3, screen }) => {
  await t3.project("Notes", NOTES_FOLDER);
  await t3.open("/");
  await expect(screen.getByText("Good", { exact: false })).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByRole("region", "Welcome")).toBeHidden();
});
