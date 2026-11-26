import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "Routines shows the week: runs to come, a run that happened, and the weeks around it",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/routines");
    await expect(screen.getByRole("heading", "Routines", { level: 1 })).toBeVisible();
    // The routines every notes folder starts with are on the coming days.
    const coming = screen.getByRole("button", "Start my day, Coming up", { exact: false });
    await expect(coming.first()).toBeVisible({ timeout: 60_000 });
    const today = screen.getByRole("button", "Today", { exact: true });
    await expect(today).toBeDisabled();

    // A run that happens shows on today, and opens its chat.
    await screen
      .getByRole("listitem")
      .filter({ hasText: "Open today's daily note" })
      .getByRole("button", "Run now")
      .tap();
    const done = screen.getByRole("link", "Start my day, Done", { exact: false });
    await expect(done).toBeVisible({ timeout: 100_000 });
    await app.screenshot("routines-this-week");

    // Next week holds only what is still to come.
    await screen.getByRole("button", "Next week").tap();
    await expect(coming.first()).toBeVisible();
    await expect(done).toBeHidden();
    await app.screenshot("routines-next-week");
    await today.tap();
    await expect(done).toBeVisible();
    await expect(today).toBeDisabled();

    await done.tap();
    await expect(screen.getByRole("heading", "Routines", { level: 1 })).toBeHidden();
  },
);
