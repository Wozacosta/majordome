import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "A settings page named in a chat is a link that opens that page",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    const thread = await t3.thread({
      project: notes,
      title: "Connect my phone",
      messages: ["connect my phone"],
      model: "screen-link",
    });
    await t3.open(thread);

    const link = screen.getByRole("link", "Phone & notifications");
    await expect(link).toBeVisible({ timeout: 30_000 });
    await app.screenshot("link-in-chat");
    await link.tap();
    await expect(screen.getByRole("heading", "Phone & notifications", { level: 1 })).toBeVisible();
    await app.screenshot("settings-page-opened");
  },
);
