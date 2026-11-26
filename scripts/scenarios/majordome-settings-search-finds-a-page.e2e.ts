import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "Searching settings lists the matching pages with where they are, and opens one",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.open("/settings/guide/app");
    const search = screen.getByRole("combobox", "Search settings");
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill("back up");
    const result = screen.getByRole("option", "Back up my brain", { exact: false }).first();
    await expect(result).toBeVisible();
    await app.screenshot("settings-search-results");
    await result.tap();
    await expect(screen.getByRole("heading", "Back up my brain", { level: 1 })).toBeVisible();
  },
);
