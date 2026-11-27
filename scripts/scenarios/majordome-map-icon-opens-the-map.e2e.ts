import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "The map icon in a chat's header opens the map of what the assistant has",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      ".majordome/topics.json": JSON.stringify({
        topics: [
          { id: "accounting", title: "Accounting", folder: "accounting" },
          { id: "garden", title: "Garden", folder: "garden" },
        ],
      }),
      "memory.md": "- Lives in Lyon\n- No meetings 14:30 to 16:00\n",
      "accounting/log.md": "## Where things stand\nVAT return is due 15 December.\n",
      "garden/plan.md": "Tomatoes along the south wall.\n",
    });
    const thread = await t3.thread({
      project: notes,
      title: "Trip to Lisbon",
      messages: ["Where to stay?"],
    });
    await t3.open(thread);

    await screen.getByLabel("What the assistant has here").tap();
    await expect(screen.getByRole("heading", "What the assistant has here")).toBeVisible();
    const map = browser.frameLocator('iframe[title="This chat"]');
    await expect(map.getByText("Memory note")).toBeVisible();
    await expect(map.getByText("Other topics")).toBeVisible();
    await app.screenshot("map-open");
    // A box opens onto what is behind it, and closes again.
    await map.getByText("Memory note").click();
    await expect(map.getByText("Lives in Lyon", { exact: false })).toBeVisible();
    await app.screenshot("memory-note-open");
    await map.getByText("Memory note").click();
    await expect(map.getByText("Lives in Lyon", { exact: false })).toBeHidden();
    // Nothing was sent to the assistant for it.
    await expect(screen.getByText("Show me a diagram", { exact: false })).toBeHidden();
  },
);
