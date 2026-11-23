import { expect } from "e2e";

import { files, NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "Writing a note could not save is still there after leaving the note and coming back",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const notes = await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/notes");

    await screen.getByRole("treeitem", "Welcome.md").tap();
    await screen.getByRole("button", "Edit").tap();
    await screen.getByLabel("This note").tap();
    await browser.keyboard.type("Saved line. ");
    await expect(screen.getByText("Saved to your notes")).toBeVisible();
    expect(await files.read(`${notes}/Welcome.md`)).toContain("Saved line.");

    // The folder refuses the next save, as a full disk or a lost connection would.
    await files.chmod(`${notes}/Welcome.md`, 0o444);
    await files.chmod(notes, 0o555);
    try {
      await browser.keyboard.type("Unsaved line. ");
      await expect(screen.getByText("Not saved", { exact: false }).first()).toBeVisible();
      await app.screenshot("not-saved");

      await screen.getByRole("treeitem", "Other.md").tap();
      await expect(screen.getByText("Another note.")).toBeVisible();
      await screen.getByRole("treeitem", "Welcome.md").tap();
      await app.screenshot("back-on-the-note");
      await expect(screen.getByText("Unsaved line.", { exact: false })).toBeVisible();
      await expect(screen.getByRole("button", "Try again")).toBeVisible();
    } finally {
      await files.chmod(notes, 0o755);
      await files.chmod(`${notes}/Welcome.md`, 0o644);
    }

    await screen.getByRole("button", "Try again").tap();
    await expect(screen.getByText("Saved to your notes")).toBeVisible();
    expect(await files.read(`${notes}/Welcome.md`)).toContain("Unsaved line.");
  },
);
