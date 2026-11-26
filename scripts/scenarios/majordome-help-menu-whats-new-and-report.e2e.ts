import { expect } from "e2e";

import { NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

const LAST_LAUNCHED = "majordome:whats-new:last-seen-version";
const NOTES_SEEN = "majordome:whats-new:notes-seen-version";

test(
  "The ? in the rail marks an update, shows what's new, and reports a problem with the version",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open();
    // A first launch has nothing to catch up on.
    await expect(screen.getByRole("button", "Help")).toBeVisible();
    await app.screenshot("first-launch-no-dot");

    await browser.evaluate(
      ([lastLaunched, notesSeen]) => {
        localStorage.setItem(lastLaunched!, JSON.stringify("0.0.1"));
        localStorage.removeItem(notesSeen!);
        return null;
      },
      [LAST_LAUNCHED, NOTES_SEEN],
    );
    await t3.open();
    await expect(screen.getByRole("button", "Help, new version")).toBeVisible();
    await app.screenshot("dot-after-update");

    await browser.evaluate(() => {
      const opened: string[] = [];
      Object.assign(window, { openedByHelp: opened });
      window.open = (url) => {
        opened.push(String(url));
        return null;
      };
      return null;
    });
    await screen.getByRole("button", "Help, new version").tap();
    await expect(screen.getByRole("menuitem", "Guides")).toBeVisible();
    await app.screenshot("menu");
    await screen.getByRole("menuitem", "Report a problem").tap();
    const reported = await browser.evaluate(
      () => (window as unknown as { openedByHelp: string[] }).openedByHelp[0] ?? "",
    );
    const report = new URL(reported);
    expect(`${report.origin}${report.pathname}`).toBe(
      "https://github.com/Wozacosta/majordome/issues/new",
    );
    expect([...report.searchParams.keys()]).toEqual(["template", "version", "environment"]);

    await screen.getByRole("button", "Help, new version").tap();
    await screen.getByRole("menuitem", "What's new").tap();
    const notes = screen.getByRole("dialog");
    await expect(notes.getByText("Try this")).toBeVisible();
    await expect(notes.getByText("Earlier versions")).toBeVisible();
    await app.screenshot("whats-new");
    await notes.getByRole("button", "Done").tap();
    await expect(screen.getByRole("button", "Help")).toBeVisible();

    // Read once, it stays read.
    await t3.open();
    await expect(screen.getByRole("button", "Help")).toBeVisible();
    await expect(screen.getByRole("button", "Help, new version")).toBeHidden();

    // With the sidebar closed, the command palette still has them.
    await browser.keyboard.press("ControlOrMeta+k");
    await browser.keyboard.type("what's new");
    await expect(screen.getByRole("option", "What's new")).toBeVisible();
    await app.screenshot("palette");
    await browser.keyboard.press("Enter");
    await expect(screen.getByRole("dialog").getByText("Try this")).toBeVisible();

    // A phone has no rail: the same menu is beside Settings at the foot of the chat list.
    await browser.setViewport({ width: 390, height: 844 });
    await t3.open();
    await screen.getByRole("button", "Toggle main sidebar").first().tap();
    await screen.getByRole("button", "Help").tap();
    await expect(screen.getByRole("menuitem", "Report a problem")).toBeVisible();
    await app.screenshot("phone-menu");
    await screen.getByRole("menuitem", "What's new").tap();
    await expect(screen.getByRole("dialog").getByText("Try this")).toBeVisible();
  },
);
