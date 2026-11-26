import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "A reply that came while the owner was elsewhere is listed under Unread, and the chat opens on a New line",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/");

    // Nothing is unread: the sidebar has no Unread group.
    const unread = screen.getByRole("region", "Unread");
    await expect(screen.getByRole("link", "Today", { exact: true })).toBeVisible();
    await expect(unread).toBeHidden();

    // Ask something, and leave before the answer is there.
    const box = screen.getByRole("textbox", "Ask anything, or tell me what to remember");
    await box.fill("Give me a short tour");
    await box.press("Enter");
    await expect(screen.getByRole("button", "Stop generation")).toBeVisible();
    await screen.getByRole("link", "Today", { exact: true }).tap();

    // The answer puts the chat under Unread.
    const row = unread.getByRole("link", "Give me a short tour", { exact: false });
    await expect(row).toBeVisible({ timeout: 100_000 });
    await app.screenshot("unread-group");

    // The Chats page lists the same chats behind its Unread switch.
    await screen.getByRole("link", "Chats", { exact: false }).first().tap();
    await screen.getByRole("button", "Unread", { exact: false }).tap();
    const listed = screen.getByRole("list", "Unread chats").last();
    await expect(listed.getByRole("link", "Give me a short tour", { exact: false })).toBeVisible();
    await app.screenshot("unread-switch");

    // Opening it shows where the unread part starts, and reading it takes it out of Unread.
    await listed.getByRole("link", "Give me a short tour", { exact: false }).tap();
    const line = screen.getByRole("separator", "New", { exact: true });
    await expect(line).toBeVisible();
    await expect(unread).toBeHidden();
    await app.screenshot("new-line");

    // The line is for that visit only.
    await screen.getByRole("link", "Today", { exact: true }).tap();
    await expect(box).toBeVisible();
    await screen.getByRole("link", "Chats", { exact: false }).first().tap();
    await screen.getByRole("link", "Give me a short tour", { exact: false }).tap();
    await expect(screen.getByRole("button", "Unread", { exact: false })).toBeHidden();
    await expect(line).toBeHidden();
    await app.screenshot("read");

    // Marked as unread, it is back under Unread and opens on the line again.
    await screen.getByRole("link", "Chats", { exact: false }).first().tap();
    await screen.getByRole("button", "More for Give me a short tour").tap();
    await screen.getByRole("menuitem", "Mark unread").tap();
    await expect(row).toBeVisible();
    await row.tap();
    await expect(line).toBeVisible();
    await expect(unread).toBeHidden();
    await app.screenshot("marked-unread-opened");
  },
);
