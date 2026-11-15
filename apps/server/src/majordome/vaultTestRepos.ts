/** Real git repositories for Majordome's vault tests: a vault, a bare "remote", another machine. */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** Matches gitleaks' GitHub token rule; it is not a real token. */
export const FAKE_GITHUB_TOKEN = "ghp_R8kQ2vT9xLmN4pR7sW1yZ3bC6dF0gH5jK2aE";

export const gitIn = Effect.fn("test.gitIn")(function* (cwd: string, args: ReadonlyArray<string>) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* git.execute({ operation: "test.vault", cwd, args });
  return result.stdout.trim();
});

const configureOwner = Effect.fn("test.configureOwner")(function* (cwd: string) {
  yield* gitIn(cwd, ["config", "user.name", "Owner"]);
  yield* gitIn(cwd, ["config", "user.email", "owner@example.com"]);
  yield* gitIn(cwd, ["config", "commit.gpgsign", "false"]);
});

/** A vault with one commit; with `remote`, also a bare remote it is pushed to. */
export const makeVault = Effect.fn("test.makeVault")(function* (options?: {
  readonly remote?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-vault-" });
  yield* gitIn(root, ["init", "--quiet", "-b", "main"]);
  yield* configureOwner(root);
  yield* fs.makeDirectory(`${root}/.majordome`);
  yield* fs.writeFileString(`${root}/.majordome/config.json`, "{}");
  yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n");
  yield* gitIn(root, ["add", "--all"]);
  yield* gitIn(root, ["commit", "--quiet", "-m", "init"]);
  if (!options?.remote) return { root, bare: null, fs };
  const bare = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-remote-" });
  // The driver only opens bare repositories named explicitly.
  yield* gitIn(root, ["init", "--quiet", "--bare", "-b", "main", bare]);
  yield* gitIn(root, ["remote", "add", "origin", bare]);
  yield* gitIn(root, ["push", "--quiet", "-u", "origin", "main"]);
  return { root, bare, fs };
});

/** Another machine's clone of the remote, to change the notes from elsewhere. */
export const cloneElsewhere = Effect.fn("test.cloneElsewhere")(function* (bare: string) {
  const fs = yield* FileSystem.FileSystem;
  const parent = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-elsewhere-" });
  const root = `${parent}/vault`;
  yield* gitIn(parent, ["clone", "--quiet", bare, root]);
  yield* configureOwner(root);
  return root;
});

export const commitAll = Effect.fn("test.commitAll")(function* (cwd: string, message: string) {
  yield* gitIn(cwd, ["add", "--all"]);
  yield* gitIn(cwd, ["commit", "--quiet", "-m", message]);
});

/** The remote's `main`. */
export const remoteMain = (bare: string) => gitIn(bare, ["--git-dir", bare, "rev-parse", "main"]);
