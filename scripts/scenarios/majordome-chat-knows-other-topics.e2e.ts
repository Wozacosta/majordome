import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

const STANDING = "VAT return is due 15 December.";

test(
  "A chat's side panel says what it starts with and where the topics stand, and opens their notes",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      ".majordome/topics.json": JSON.stringify({
        topics: [
          { id: "accounting", title: "Accounting", folder: "accounting" },
          { id: "garden", title: "Garden", folder: "garden" },
        ],
      }),
      "memory.md": "- Lives in Lyon\n",
      "accounting/log.md": `## Where things stand\n${STANDING}\n\n## 2026-11-10\nPaid the accountant.\n`,
      "garden/plan.md": "Tomatoes along the south wall.\n",
    });
    const thread = await t3.thread({
      project: notes,
      title: "Trip to Lisbon",
      messages: ["Where to stay?"],
    });
    await t3.open(thread);

    await expect(screen.getByText("What this chat knows")).toBeVisible();
    await expect(screen.getByText("Shared by every chat")).toBeVisible();
    await expect(screen.getByText("Your topics")).toBeVisible();
    await expect(screen.getByText(STANDING)).toBeVisible();
    await expect(screen.getByRole("list", "Your topics").getByText("Garden")).toBeVisible();
    await app.screenshot("what-this-chat-knows");

    await screen.getByText(STANDING).tap();
    await expect(screen.getByText("Paid the accountant.")).toBeVisible();
    await app.screenshot("topic-log-opened");
  },
);
