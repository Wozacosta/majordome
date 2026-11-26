import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "Routines offers ready-made routines as picture cards, and a card adds its routine",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/routines");
    await expect(screen.getByRole("heading", "Routines", { level: 1 })).toBeVisible();

    // The cards come after the routines every notes folder starts with.
    const routines = screen.getByRole("list", "Routines", { exact: true });
    await expect(routines.getByText("Start my day", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const cards = screen.getByRole("list", "Add a routine", { exact: true });
    const journal = cards.getByRole("button", "Evening journal prompt", { exact: false });
    await expect(journal).toBeVisible();
    await expect(
      journal.getByText("Every day at 21:00, asks one question about your day", { exact: false }),
    ).toBeVisible();
    await expect(cards.getByRole("button", "Your own", { exact: false })).toBeVisible();
    await app.screenshot("routine-cards");

    // One click adds it: it joins the list and is no longer offered.
    await journal.tap();
    await expect(routines.getByText("Evening journal prompt", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(journal).toBeHidden();
    await app.screenshot("routine-added-from-card");
  },
);
