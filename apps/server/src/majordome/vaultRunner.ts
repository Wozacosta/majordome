/**
 * One server runs a vault's routines and inbox watcher: the one whose environment id is in
 * `.majordome/runner`, a one-line text file. A vault without one is claimed by the first server
 * that looks; the claim travels with the next save. Moving the runner is explicit and committed
 * at once, so it leaves before both servers run routines. No heartbeat, no automatic takeover.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { hasUnfinishedMerge } from "./vaultAutosave.ts";
import { VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";
import { MAJORDOME_AUTHOR } from "./VaultCommitReactor.ts";

const RUNNER_FILENAME = "runner";

const runnerPath = (path: Path.Path, vaultRoot: string) =>
  path.join(vaultRoot, VAULT_CONFIG_DIRNAME, RUNNER_FILENAME);

/** The environment id named in the vault's runner file, if any. */
export const readVaultRunner = Effect.fn("majordome.readVaultRunner")(function* (
  vaultRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem.readFileString(runnerPath(path, vaultRoot)).pipe(Effect.option);
  return Option.filter(
    Option.map(text, (value) => value.trim()),
    (value) => value !== "",
  );
});

export const writeVaultRunner = Effect.fn("majordome.writeVaultRunner")(function* (input: {
  readonly vaultRoot: string;
  readonly environmentId: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(runnerPath(path, input.vaultRoot), `${input.environmentId}\n`);
});

/**
 * Makes this server the runner and commits only the runner file, as Majordome. True when it made
 * a commit. A folder without git history, or in the middle of a merge, keeps the file uncommitted.
 * Callers hold the vault's lock.
 */
export const moveVaultRunner = Effect.fn("majordome.moveVaultRunner")(function* (input: {
  readonly vaultRoot: string;
  readonly environmentId: string;
  /** Names the server in the commit message. */
  readonly serverLabel: string;
}) {
  yield* writeVaultRunner(input);
  const git = yield* GitVcsDriver.GitVcsDriver;
  const file = `${VAULT_CONFIG_DIRNAME}/${RUNNER_FILENAME}`;
  const run = (args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    git.execute({
      operation: "majordome.moveVaultRunner",
      cwd: input.vaultRoot,
      args,
      allowNonZeroExit,
      env: {
        GIT_AUTHOR_NAME: MAJORDOME_AUTHOR.name,
        GIT_AUTHOR_EMAIL: MAJORDOME_AUTHOR.email,
        GIT_COMMITTER_NAME: MAJORDOME_AUTHOR.name,
        GIT_COMMITTER_EMAIL: MAJORDOME_AUTHOR.email,
      },
    });
  if ((yield* run(["rev-parse", "--verify", "--quiet", "HEAD"], true)).exitCode !== 0) return false;
  if (yield* hasUnfinishedMerge(input.vaultRoot)) return false;
  yield* run(["add", "--", file]);
  if ((yield* run(["diff", "--cached", "--quiet", "--", file], true)).exitCode === 0) return false;
  // Only this file, whatever else is staged. Unsigned and without hooks, like run commits.
  yield* run([
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--no-verify",
    "--message",
    `majordome: Routines run on ${input.serverLabel}`,
    "--",
    file,
  ]);
  return true;
});

/**
 * True when this server runs the vault's routines. A vault with no runner yet becomes this
 * server's. If the claim cannot be written, nothing runs here: two runners are worse than none.
 */
export const isVaultRunner = Effect.fn("majordome.isVaultRunner")(function* (input: {
  readonly vaultRoot: string;
  readonly environmentId: string;
}) {
  const runner = yield* readVaultRunner(input.vaultRoot);
  if (Option.isSome(runner)) return runner.value === input.environmentId;
  return yield* writeVaultRunner(input).pipe(
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.logWarning("Majordome could not claim a vault's routines for this server.", {
        cause,
      }).pipe(Effect.as(false)),
    ),
  );
});
