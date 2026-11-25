import { expect } from "e2e";

import { forgetSavedKeys, NOTES_FOLDER } from "./majordome.ts";
import { test, WEB } from "./t3.ts";

test(
  "A saved key says until when it works, and that day can be changed and cleared",
  WEB,
  async ({ t3, app, screen }) => {
    await forgetSavedKeys();
    await t3.project("Notes", NOTES_FOLDER);
    await t3.open("/settings/secrets");

    await screen.getByRole("button", "Add a key").tap();
    await screen.getByLabel("Name").fill("garmin");
    await screen.getByLabel("The key").fill("gm_live_4f9a2c7e1b");
    // How long it lasts is turned into a day before saving.
    await screen.getByLabel("Works until (optional)").fill("1 year");
    await expect(screen.getByText(/Works until .+\. Your assistant tells you/)).toBeVisible();
    await app.screenshot("works-until-typed");
    await screen.getByRole("button", "Save key").tap();
    await expect(screen.getByText(/Works until .+ · Not used yet/)).toBeVisible();

    // A day already past is said as such, with what to do.
    await screen.getByRole("button", "Change last day").tap();
    await screen.getByLabel("garmin works until").fill("2020-01-01");
    await screen.getByRole("button", "Save").tap();
    await expect(screen.getByText(/Stopped working .+2020/)).toBeVisible();
    await expect(screen.getByText("Past its last day.", { exact: false })).toBeVisible();
    await app.screenshot("past-its-last-day");

    await screen.getByRole("button", "Change last day").tap();
    await screen.getByRole("button", "No end date").tap();
    await expect(screen.getByText("Not used yet", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Set last day")).toBeVisible();

    await forgetSavedKeys();
  },
);
