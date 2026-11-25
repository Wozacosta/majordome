import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { NOTES_FOLDER } from "./majordome.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

const KEY = "gm_live_4f9a2c7e1b";

/** What `majord secret list` prints: the names the server's own key file holds, one a line. */
const savedNames = async () =>
  (await runPromise(makeState(T3_HOME).cli(["secret", "list"]))).stdout
    .split("\n")
    .map((line) => line.trim());

test(
  "A key added in Passwords and keys is listed, is in the server's key file, and is removed",
  WEB,
  async ({ t3, app, screen }) => {
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/settings/secrets");
    await expect(screen.getByText("No keys saved yet.")).toBeVisible();

    await screen.getByRole("button", "Add a key").tap();
    await screen.getByLabel("Name").fill("Garmin API");
    await screen.getByLabel("What it is for (optional)").fill("Read my runs");
    await screen.getByLabel("The key").fill(KEY);
    await expect(screen.getByText("Saved as garmin-api.")).toBeVisible();
    await app.screenshot("add-a-key");
    await screen.getByRole("button", "Save key").tap();

    await expect(screen.getByText("Read my runs · Not used yet")).toBeVisible();
    // The key is never shown again, and the terminal command reads the same file.
    await expect(screen.getByText(KEY)).toBeHidden();
    expect(await savedNames()).toContain("garmin-api");
    await app.screenshot("key-listed");

    await screen.getByRole("button", "Remove").tap();
    await screen.getByRole("alertdialog").getByRole("button", "Remove").tap();
    await expect(screen.getByText("No keys saved yet.")).toBeVisible();
    expect(await savedNames()).not.toContain("garmin-api");
  },
);
