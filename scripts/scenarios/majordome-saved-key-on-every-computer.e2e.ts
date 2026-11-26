import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { T3_HOME } from "../e2e.config.ts";
import { forgetSavedKeys } from "./majordome.ts";
import { SECOND_HOME, startSecondServer } from "./second-server.ts";
import { run } from "./shell.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

/** What `majord secret list` prints for a home: the names its own key file holds. */
const savedNames = async (home: string) =>
  (await runPromise(makeState(home).cli(["secret", "list"]))).stdout
    .split("\n")
    .map((line) => line.trim());

test(
  "A key added once in Passwords and keys is on every computer that holds the notes, and removed from all",
  WEB,
  async ({ t3, app, screen }) => {
    await forgetSavedKeys();
    const primary = makeState(T3_HOME);
    const second = makeState(SECOND_HOME);
    // Two computers hold the same notes when their folders share a first commit.
    const notes = await runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.join(T3_HOME, "workspaces"), { recursive: true });
        const directory = yield* fs.makeTempDirectory({
          directory: path.join(T3_HOME, "workspaces"),
          prefix: "notes-",
        });
        yield* fs.makeDirectory(path.join(directory, ".majordome"));
        yield* fs.writeFileString(path.join(directory, ".majordome/config.json"), "{}\n");
        yield* fs.writeFileString(path.join(directory, "Welcome.md"), "# Welcome\n");
        return directory;
      }),
    );
    const git = (args: ReadonlyArray<string>) => runPromise(run("git", args, { cwd: notes }));
    await git(["init", "--quiet", "--initial-branch=main"]);
    await git(["add", "--all"]);
    await git([
      "-c",
      "user.name=Scenario",
      "-c",
      "user.email=scenario@example.invalid",
      "commit",
      "--quiet",
      "--message",
      "First notes",
    ]);
    await runPromise(primary.cli(["project", "add", notes, "--title", "Notes"]));
    const server = startSecondServer(app.baseUrl ?? "");
    try {
      const { host, token } = await server.ready;
      await runPromise(second.cli(["project", "add", notes, "--title", "Notes"]));

      // A key saved while this computer was the only one: the other does not have it.
      await t3.open("/settings/secrets");
      await screen.getByRole("button", "Add a key").tap();
      await screen.getByLabel("Name").fill("myage");
      await screen.getByLabel("The key").fill("age_before_the_second_computer");
      await screen.getByRole("button", "Save key").tap();
      await expect(screen.getByText("Not used yet")).toBeVisible();

      await t3.open("/settings/connections");
      await screen.getByRole("button", "Add a computer").tap();
      const dialog = screen.getByRole("dialog");
      await dialog.getByPlaceholder("backend.example.com").fill(host);
      await dialog.getByPlaceholder("PAIRCODE").fill(token);
      await dialog.getByRole("button", "Add a computer").tap();
      await screen.getByRole("button", "List", { exact: true }).tap();
      await expect(screen.getByRole("button", "More actions for Scenario")).toBeVisible({
        timeout: 60_000,
      });

      // One list for both computers; the older key says where it is missing.
      await t3.open("/settings/secrets");
      await expect(
        screen.getByText("Save it again to have it everywhere", { exact: false }),
      ).toBeVisible({ timeout: 60_000 });
      await app.screenshot("key-on-one-computer");

      // With two computers, the assistant's message box says which one answers.
      await screen.getByRole("button", "Assistant").tap();
      await expect(screen.getByRole("img", "Answered on", { exact: false })).toBeVisible({
        timeout: 30_000,
      });
      await app.screenshot("assistant-says-where-it-answers");
      await screen.getByRole("button", "Back to the page").tap();

      await screen.getByRole("button", "Add a key").tap();
      await screen.getByLabel("Name").fill("Garmin API");
      await screen.getByLabel("What it is for (optional)").fill("Read my runs");
      await screen.getByLabel("The key").fill("gm_live_4f9a2c7e1b");
      await expect(screen.getByText("Saved on", { exact: false })).toBeVisible();
      await app.screenshot("add-a-key-for-both");
      await screen.getByRole("button", "Save key").tap();
      await expect(screen.getByText("Read my runs · Not used yet")).toBeVisible();
      expect(await savedNames(T3_HOME)).toContain("garmin-api");
      expect(await savedNames(SECOND_HOME)).toContain("garmin-api");
      expect(await savedNames(SECOND_HOME)).not.toContain("myage");
      await app.screenshot("key-on-both");

      // Saving the older key again puts it on both, and its row stops saying where it is.
      await screen.getByRole("button", "Add a key").tap();
      await screen.getByLabel("Name").fill("myage");
      await screen.getByLabel("The key").fill("age_on_both");
      await screen.getByRole("button", "Replace key").tap();
      await expect(
        screen.getByText("Save it again to have it everywhere", { exact: false }),
      ).toBeHidden();
      expect(await savedNames(SECOND_HOME)).toContain("myage");

      // Removing reaches both.
      await screen.getByRole("button", "Remove").first().tap();
      await screen.getByRole("alertdialog").getByRole("button", "Remove").tap();
      await expect(screen.getByText("Read my runs · Not used yet")).toBeHidden();
      expect(await savedNames(T3_HOME)).not.toContain("garmin-api");
      expect(await savedNames(SECOND_HOME)).not.toContain("garmin-api");
    } finally {
      await server.stop();
      await runPromise(primary.cli(["project", "remove", notes, "--force"]));
    }
  },
);
