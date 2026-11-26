/// <reference lib="dom" />
import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

interface Captured {
  copied?: string;
  saved?: string;
}

test(
  "A table in an answer copies as CSV, and a file named in a chat downloads from its chip",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    const thread = await t3.thread({
      project: notes,
      title: "What happened",
      messages: ["What did people ask about?"],
      model: "table-and-file",
    });
    await t3.open(thread);
    const copyTable = screen.getByRole("button", "Copy table").first();
    await expect(copyTable).toBeVisible({ timeout: 120_000 });

    // What leaves the page is recorded here instead of landing on this machine.
    await browser.evaluate(() => {
      const captured: Captured = {};
      Object.assign(window, { captured });
      navigator.clipboard.writeText = async (text) => {
        captured.copied = text;
      };
      navigator.clipboard.write = async (items) => {
        captured.copied = await (await items[0]!.getType("text/plain")).text();
      };
      HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
        if (this.download) captured.saved = this.download;
      };
      return null;
    });
    const copied = () =>
      browser.evaluate(() => (window as unknown as { captured: Captured }).captured.copied ?? null);
    const saved = () =>
      browser.evaluate(() => (window as unknown as { captured: Captured }).captured.saved ?? null);

    const openChipMenu = () =>
      browser.evaluate(() => {
        const chip = document.querySelector<HTMLElement>(".chat-markdown-file-link")!;
        const { left, bottom } = chip.getBoundingClientRect();
        chip.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: left + 4,
            clientY: bottom - 4,
          }),
        );
        return null;
      });

    await copyTable.tap();
    await app.screenshot("table-copy-menu");
    await screen.getByRole("menuitem", "Copy as CSV").tap();
    await expect.poll(copied).toBe(
      // Cells with a comma or a quote are quoted, and the quote doubled.
      'Signal,Posts,Note\nOffline mode,84,"Up, ""3x"""\n"Shared notes, tags",51,Steady',
    );

    await openChipMenu();
    const download = screen.getByRole("menuitem", "Download");
    await expect(download).toBeVisible();
    await app.screenshot("file-chip-menu");
    await download.tap();
    await expect.poll(saved).toBe("Welcome.md");

    // The same two menus at phone width, in the dark theme.
    await browser.setViewport({ width: 390, height: 844 });
    await browser.evaluate(() => {
      localStorage.setItem("t3code:theme", "dark");
      return null;
    });
    await t3.open(thread);
    await expect(copyTable).toBeVisible({ timeout: 30_000 });
    await copyTable.tap();
    await expect(screen.getByRole("menuitem", "Copy as CSV")).toBeVisible();
    await app.screenshot("table-copy-menu-phone-dark");
    await browser.keyboard.press("Escape");
    await openChipMenu();
    await expect(screen.getByRole("menuitem", "Download")).toBeVisible();
    await app.screenshot("file-chip-menu-phone-dark");
    await browser.evaluate(() => {
      localStorage.removeItem("t3code:theme");
      return null;
    });
  },
);
