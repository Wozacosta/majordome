import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "The map icon in a chat's header asks the assistant to draw what it has",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    const thread = await t3.thread({
      project: notes,
      title: "Trip to Lisbon",
      messages: ["Where to stay?"],
    });
    await t3.open(thread);

    await expect(screen.getByLabel("What the assistant has here")).toBeVisible();
    await app.screenshot("map-icon-in-header");
    await screen.getByLabel("What the assistant has here").tap();
    await expect(
      screen.getByText("Show me a diagram of what you know", { exact: false }),
    ).toBeVisible();
    await app.screenshot("request-sent");
  },
);
