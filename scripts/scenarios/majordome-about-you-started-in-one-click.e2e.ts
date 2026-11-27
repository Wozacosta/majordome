import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

const REQUEST = "Start my About you note";

test(
  "Notes with no note about their owner offer to start it, from the chat panel and from the map",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      "memory.md": "- Lives in Lyon\n",
    });
    const thread = await t3.thread({
      project: notes,
      title: "Trip to Lisbon",
      messages: ["Where to stay?"],
    });
    await t3.open(thread);

    // The panel names the note as not started, with the way to start it on the same row.
    const panel = screen.getByRole("list", "It starts with");
    // The first page of a run can take longer than an ordinary check allows.
    await expect(panel.getByText("About you")).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByText("Nothing yet")).toBeVisible();
    await expect(panel.getByText("Start it from my notes")).toBeVisible();
    await app.screenshot("panel-offers-to-start");

    // The map says the same, and its button starts a chat that asks for it.
    await screen.getByLabel("What your assistant can see and do").tap();
    const map = browser.frameLocator('iframe[title="This chat"]');
    await expect(map.getByText("Nothing yet")).toBeVisible();
    await expect(
      screen.getByText("is empty. Your assistant can write it", { exact: false }),
    ).toBeVisible();
    await app.screenshot("map-offers-to-start");
    await screen.getByRole("button", "Start it from my notes").tap();

    // The request shows as the message and, once the chat is named, as its title.
    await expect(screen.getByText(REQUEST, { exact: false }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(screen.getByRole("heading", "What your assistant can see and do")).toBeHidden();
    await app.screenshot("chat-started");
  },
);
