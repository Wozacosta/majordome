import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "Connections shows each service as a card, and a card's button opens where it is set up",
  WEB,
  async ({ t3, app, screen, browser }) => {
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/settings/connectors");
    await expect(screen.getByRole("heading", "Connections", { level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(screen.getByText("Google Drive", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await app.screenshot("connections-desktop-light");

    // Phone width: the cards stack in one column, each with its button still in reach.
    await browser.setViewport({ width: 390, height: 844 });
    await t3.open("/settings/connectors");
    await expect(screen.getByText("Google Drive", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await app.screenshot("connections-phone-light");

    await browser.evaluate(() => {
      localStorage.setItem("t3code:theme", "dark");
      return null;
    });
    await t3.open("/settings/connectors");
    await expect(screen.getByText("Google Drive", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await app.screenshot("connections-phone-dark");
    await browser.setViewport({ width: 1280, height: 800 });
    await t3.open("/settings/connectors");
    await expect(screen.getByText("Google Drive", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await app.screenshot("connections-desktop-dark");
    await browser.evaluate(() => {
      localStorage.removeItem("t3code:theme");
      return null;
    });

    const card = browser.locator('[data-connection="Google Drive"]');
    await card.getByRole("link", "Set up").tap();
    await expect(screen.getByRole("heading", "Back up my brain", { level: 1 })).toBeVisible();
  },
);
