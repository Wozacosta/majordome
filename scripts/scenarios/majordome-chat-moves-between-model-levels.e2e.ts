import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "A level is given a model in Settings, and a chat moves to it from the message box",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/settings/providers");
    await expect(screen.getByRole("heading", "Levels of AI")).toBeVisible();
    await screen.getByLabel("Powerful model").tap();
    await screen.getByRole("option", "Multi turn").tap();
    await expect(screen.getByLabel("Powerful model")).toHaveText("Multi turn");
    await app.screenshot("models-in-settings");

    const thread = await t3.thread({
      project: notes,
      title: "Tax question",
      messages: ["Hello"],
      model: "showcase",
    });
    await t3.open(thread);
    await screen.getByLabel("Model: Everyday").tap();
    await expect(screen.getByRole("option", "Powerful", { exact: false })).toBeVisible();
    await app.screenshot("levels-in-message-box");
    await screen.getByRole("option", "Powerful", { exact: false }).tap();
    await expect(screen.getByLabel("Model: Powerful")).toBeVisible();

    // Only the Powerful model's recording answers with this line.
    await screen.getByRole("textbox").fill("And now the hard part");
    await browser.keyboard.press("Enter");
    await expect(screen.getByText("first fixture turn complete", { exact: false })).toBeVisible();
    await expect(screen.getByLabel("Model: Powerful")).toBeVisible();
  },
);
