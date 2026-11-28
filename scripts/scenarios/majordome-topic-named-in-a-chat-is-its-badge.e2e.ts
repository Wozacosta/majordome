import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "A topic the assistant names in a chat wears that topic's badge, which opens the topic",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      ".majordome/topics.json": JSON.stringify({
        topics: [
          { id: "fitness", title: "Fitness", folder: "fitness" },
          { id: "quitting-nicotine", title: "Quitting nicotine", folder: "nicotine" },
        ],
      }),
      "fitness/log.md": "## Where things stand\nThree runs a week.\n",
      "nicotine/log.md": "## Where things stand\nDay 19.\n",
    });
    const thread = await t3.thread({
      project: notes,
      title: "Run tomorrow",
      messages: ["what would be a good distance to run tomorrow?"],
      model: "topic-link",
    });
    await t3.open(thread);

    const badge = screen.getByRole("button", "Fitness");
    await expect(badge).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole("button", "Quitting nicotine")).toBeVisible();
    // A topic that is not in the list any more reads as its name, with no badge.
    await expect(screen.getByText("Old plan")).toBeVisible();
    await expect(screen.getByRole("button", "Old plan")).toBeHidden();
    await app.screenshot("topics-named-in-a-chat");

    await badge.tap();
    await expect(screen.getByText("Three runs a week.")).toBeVisible({ timeout: 30_000 });
    await app.screenshot("topic-opened");
  },
);
