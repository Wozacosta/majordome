import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

const NOTICE = "See what changed and what is worth trying.";
const LAST_SEEN = "majordome:whats-new:last-seen-version";

test(
  "Opening the app after an update offers what's new once, and About keeps it",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open();
    await browser.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify("0.0.1"));
      return null;
    }, LAST_SEEN);

    await t3.open();
    await expect(screen.getByText(NOTICE)).toBeVisible();
    await app.screenshot("update-notice");
    await screen.getByRole("button", "See what's new").tap();
    const notes = screen.getByRole("dialog");
    await expect(notes.getByText("Try this")).toBeVisible();
    await app.screenshot("whats-new");
    await notes.getByRole("button", "Done").tap();

    await t3.open("/settings/about");
    await expect(screen.getByText("Version")).toBeVisible();
    await expect(screen.getByText(NOTICE)).toBeHidden();
    await app.screenshot("about-row");
    await screen.getByRole("button", "See what's new").tap();
    await expect(screen.getByRole("dialog").getByText("Try this")).toBeVisible();
  },
);
