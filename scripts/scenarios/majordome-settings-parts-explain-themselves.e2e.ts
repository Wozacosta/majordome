import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Settings shows six parts; a part's name opens a page that explains it and unfolds its pages",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.open("/settings/guide/app");
    for (const part of ["This app", "Notes", "Files & credentials", "AI", "Others"]) {
      await expect(screen.getByRole("button", part, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    }
    // Nothing of a part shows until it is opened.
    await expect(screen.getByRole("button", "AI accounts", { exact: true })).toBeHidden();

    await screen.getByRole("button", "AI", { exact: true }).tap();
    await expect(screen.getByRole("heading", "AI", { level: 1 })).toBeVisible();
    await expect(screen.getByRole("group", "does the thinking", { exact: false })).toBeVisible();
    await expect(screen.getByRole("button", "AI accounts", { exact: true })).toBeVisible();
    await app.screenshot("settings-ai-explained");

    // A box of the drawing that stands for a page opens it.
    await screen.getByRole("link", "Connections Mail, calendar", { exact: false }).tap();
    await expect(screen.getByRole("heading", "Connections", { level: 1 })).toBeVisible();
    await screen.getByRole("button", "AI", { exact: true }).tap();
    await expect(screen.getByRole("heading", "AI", { level: 1 })).toBeVisible();

    // The page lists the part's pages, and each opens.
    await screen.getByRole("link", "Open Skills").tap();
    await expect(screen.getByRole("heading", "Skills", { level: 1 })).toBeVisible();

    await screen.getByRole("button", "You and your devices", { exact: true }).tap();
    await expect(screen.getByRole("heading", "You and your devices", { level: 1 })).toBeVisible();
    await expect(screen.getByRole("button", "Your servers", { exact: true })).toBeVisible();
    await app.screenshot("settings-devices-explained");

    // A part with no page of its own only unfolds.
    await screen.getByRole("button", "Others", { exact: true }).tap();
    await expect(screen.getByRole("button", "Labs", { exact: true })).toBeVisible();
    await expect(screen.getByRole("heading", "You and your devices", { level: 1 })).toBeVisible();
  },
);
