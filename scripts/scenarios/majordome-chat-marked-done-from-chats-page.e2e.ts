import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "A chat marked as done from its row on the Chats page moves under Done",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    await t3.thread({ project: notes, title: "Trip to Lisbon", messages: ["Where to stay?"] });
    await t3.open("/chats");

    await screen.getByRole("button", "More for Trip to Lisbon").tap();
    await app.screenshot("row-menu");
    await screen.getByRole("menuitem", "Mark as done").tap();
    await app.screenshot("marked-done");
    await expect(screen.getByText("Done (1)")).toBeVisible();
  },
);
