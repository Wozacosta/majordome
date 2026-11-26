import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "A page pinned from More stays in the rail after a reload, and an unpinned one opens from More",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open();

    await screen.getByRole("button", "More").tap();
    await screen.getByRole("button", "Pin Reminders").tap();
    await screen.getByRole("button", "Unpin Reading list").tap();

    await t3.open();
    await expect(screen.getByRole("link", "Reminders")).toBeVisible();
    await screen.getByRole("button", "More").tap();
    await app.screenshot("more-after-reload");
    await screen.getByRole("link", "Reading list").tap();
    await expect(screen.getByRole("heading", "Reading list")).toBeVisible();
  },
);
