import { expect } from "e2e";

import { forgetSavedKeys, NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "A key kept in a secret source is saved by where it is, once Majordome can read it there",
  WEB,
  async ({ t3, app, screen }) => {
    await forgetSavedKeys();
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/settings/secrets");

    // What the source will hold: a key in the server's own key file.
    await screen.getByRole("button", "Add a key").tap();
    await screen.getByLabel("Name").fill("garmin");
    await screen.getByLabel("The key").fill("gm_live_4f9a2c7e1b");
    await screen.getByRole("button", "Save key").tap();
    await expect(screen.getByText("Not used yet")).toBeVisible();

    await screen.getByRole("button", "Add source").tap();
    const dialog = screen.getByRole("dialog");
    await dialog.getByLabel("Where the secrets are").tap();
    await screen.getByRole("option", "Encrypted file").tap();
    await dialog.getByLabel("Name").fill("toto");
    await dialog.getByRole("button", "Add source").tap();
    await expect(screen.getByText("toto")).toBeVisible();

    await screen.getByRole("button", "Add a key").tap();
    await screen.getByLabel("Name").fill("runs");
    await screen.getByLabel("The key source").tap();
    await screen.getByRole("option", "toto").tap();
    const where = screen.getByLabel("Where it is in toto");

    // Nothing there under that name: refused now, not when a routine needs it.
    await where.fill("secret://strava");
    await screen.getByRole("button", "Save key").tap();
    await expect(
      screen.getByText(
        "Majordome couldn't read that from toto. Check what you entered, and that toto is set up on this computer.",
      ),
    ).toBeVisible();
    await app.screenshot("unreadable-reference");

    await where.fill("secret://garmin");
    await screen.getByRole("button", "Save key").tap();
    await expect(screen.getByText("Kept in toto · Not used yet")).toBeVisible();
    await app.screenshot("key-kept-in-source");

    // Left as found: the server outlives the test.
    for (const confirm of ["Remove", "Remove", "Remove source"]) {
      await screen.getByRole("button", "Remove").nth(0).tap();
      await screen.getByRole("alertdialog").getByRole("button", confirm).tap();
      await expect(screen.getByRole("alertdialog")).toBeHidden();
    }
    await expect(screen.getByText("No keys saved yet.")).toBeVisible();
  },
);
