import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "The sidebar's Chats row lists the chats still going under it",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    await t3.thread({ project: notes, title: "Trip to Lisbon", messages: ["Where to stay?"] });
    await t3.open();

    await screen.getByRole("button", "Show chats").tap();
    await app.screenshot("chats-listed");
    await expect(screen.getByRole("link", "Trip to Lisbon")).toBeVisible();
  },
);
