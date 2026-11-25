import { expect } from "e2e";

import { forgetSavedKeys, NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "The key a Bitwarden Secrets Manager source signs in with is marked as not the assistant's",
  WEB,
  async ({ t3, app, screen }) => {
    await forgetSavedKeys();
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/settings/secrets");

    await screen.getByRole("button", "Add a key").tap();
    await screen.getByLabel("Name").fill("bitwarden");
    await screen.getByLabel("The key").fill("0.48c78342-1635-48a6-accd-afbe01336365.x:y");
    await screen.getByRole("button", "Save key").tap();
    await expect(screen.getByText("Not used yet")).toBeVisible();

    await screen.getByRole("button", "Add source").tap();
    const dialog = screen.getByRole("dialog");
    await dialog.getByLabel("Where the secrets are").tap();
    await screen.getByRole("option", "Bitwarden Secrets Manager").tap();
    await dialog.getByLabel("Name").fill("My Bitwarden");
    // A name that could be read as a command-line flag is refused before anything is saved.
    await dialog.getByLabel("Access token's name").fill("--access-token");
    await dialog.getByRole("button", "Add source").tap();
    await expect(
      dialog.getByText(
        "Enter the name the access token is saved under: letters, digits, and . _ or -.",
      ),
    ).toBeVisible();
    await dialog.getByLabel("Access token's name").fill("bitwarden");
    await dialog.getByLabel("Server (optional)").fill("https://vault.bitwarden.eu");
    await app.screenshot("bitwarden-source");
    await dialog.getByRole("button", "Add source").tap();

    await expect(
      screen.getByText("Signs Majordome in to My Bitwarden. Your assistant cannot take it."),
    ).toBeVisible();
    await app.screenshot("sign-in-key");

    // Left as found: the server outlives the test.
    for (const confirm of ["Remove", "Remove source"]) {
      await screen.getByRole("button", "Remove").nth(0).tap();
      await screen.getByRole("alertdialog").getByRole("button", confirm).tap();
      await expect(screen.getByRole("alertdialog")).toBeHidden();
    }
    await expect(screen.getByText("No keys saved yet.")).toBeVisible();
  },
);
