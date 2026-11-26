import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { T3_HOME } from "../e2e.config.ts";
import { SECOND_HOME, startSecondServer } from "./second-server.ts";
import { run } from "./shell.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

test(
  "Your servers lists a server added from the page, says what is on it, and removes it from the app",
  WEB,
  async ({ t3, app, screen }) => {
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

      await t3.open("/settings/always-on");
      await expect(screen.getByRole("heading", "Your servers", { level: 1 })).toBeVisible();
      await screen.getByRole("button", "Add a computer").tap();
      const dialog = screen.getByRole("dialog");
      await dialog.getByPlaceholder("backend.example.com").fill(host);
      await dialog.getByPlaceholder("PAIRCODE").fill(token);
      await dialog.getByRole("button", "Add a computer").tap();

      // The new server is listed with what is on it, without a visit to Computers.
      const removeButton = screen.getByRole("button", "Remove Scenario from this app");
      await expect(removeButton).toBeVisible({ timeout: 60_000 });
      await expect(screen.getByText("Has a copy of your notes.").first()).toBeVisible({
        timeout: 60_000,
      });
      await app.screenshot("your-servers-two-servers");

      await removeButton.tap();
      await app.screenshot("your-servers-remove-dialog");
      await screen.getByRole("alertdialog").getByRole("button", "Remove from this app").tap();
      await expect(removeButton).toBeHidden({ timeout: 30_000 });
    } finally {
      await server.stop();
      await runPromise(primary.cli(["project", "remove", notes, "--force"]));
    }
  },
);
