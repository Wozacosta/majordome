import { expect } from "e2e";

import { files, forgetNotesFolder, NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

const PASSPHRASE = "correct horse battery staple";

test(
  "Notes backed up to a folder with a passphrase come back from it as a new notes folder",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    // Beside the notes folder, in the same throwaway folder.
    const copies = `${notes}-copies`;
    await files.makeFolder(copies);
    await t3.open("/backup");
    await app.screenshot("backup-page");

    await screen.getByText("Type a path instead").tap();
    await screen.getByLabel("Backup folder").fill(copies);
    await screen.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await screen.getByLabel("Passphrase again").fill(PASSPHRASE);
    await expect(screen.getByText("Write this passphrase down on paper")).toBeVisible();
    await app.screenshot("passphrase-form");
    await screen.getByRole("button", "Back up to this folder").tap();

    await expect(screen.getByText("Your first encrypted copy is in the folder")).toBeVisible();
    await expect(screen.getByText(PASSPHRASE)).toBeHidden();
    expect((await files.list(copies)).some((name) => name.endsWith(".age"))).toBe(true);

    const restored = `${notes}-restored`;
    await files.makeFolder(restored);
    await screen.getByRole("button", "Restore from a backup").tap();
    const typed = browser.locator("[data-restore-notes] summary");
    await typed.nth(0).tap();
    await typed.nth(1).tap();
    await screen.getByLabel("Backup file or folder").fill(copies);
    await screen.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await screen.getByLabel("Folder to put your notes in").fill(restored);
    try {
      await screen.getByRole("button", "Restore my notes").tap();

      await expect(screen.getByText("Your notes are back")).toBeVisible({ timeout: 60_000 });
      await app.screenshot("restored");
      expect(await files.read(`${restored}/Majordome/Welcome.md`)).toBe(NOTES_FOLDER["Welcome.md"]);
    } finally {
      await forgetNotesFolder(`${restored}/Majordome`);
    }
  },
);
