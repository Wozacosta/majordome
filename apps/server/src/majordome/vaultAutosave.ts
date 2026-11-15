/**
 * "Your edits": the owner's own changes to a vault, committed every few minutes under the owner's
 * name so they are in the history and can be backed up. A secret scan runs first when gitleaks is
 * installed; on a hit nothing is committed and the changes are left unstaged. Callers hold the
 * vault's lock.
 */

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { scanForSecrets } from "./vaultSecretScan.ts";

const YOUR_EDITS_SUBJECT = "Your edits";

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

export const identityEnv = (identity: GitIdentity) => ({
  GIT_AUTHOR_NAME: identity.name,
  GIT_AUTHOR_EMAIL: identity.email,
  GIT_COMMITTER_NAME: identity.name,
  GIT_COMMITTER_EMAIL: identity.email,
});

export const listLines = (stdout: string) =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** The vault's git user, or the computer's user when git has none configured. */
export const ownerIdentity = Effect.fn("majordome.ownerIdentity")(function* (cwd: string) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const read = (key: string) =>
    git
      .execute({
        operation: "majordome.ownerIdentity",
        cwd,
        args: ["config", "--get", key],
        allowNonZeroExit: true,
      })
      .pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "")));
  const name = yield* read("user.name");
  const email = yield* read("user.email");
  const username = (yield* HostProcess.Username) ?? "owner";
  const hostname = yield* HostProcess.Hostname;
  return {
    name: name || username,
    email: email || `${username}@${hostname || "localhost"}`,
  } satisfies GitIdentity;
});

const UNFINISHED_MARKERS = [
  "rebase-merge",
  "rebase-apply",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
];

/** True while a rebase, merge, cherry-pick or revert waits to be finished by hand. */
export const hasUnfinishedMerge = Effect.fn("majordome.hasUnfinishedMerge")(function* (
  cwd: string,
) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const gitDir = yield* git.execute({
    operation: "majordome.gitDir",
    cwd,
    args: ["rev-parse", "--absolute-git-dir"],
    allowNonZeroExit: true,
  });
  if (gitDir.exitCode !== 0) return false;
  for (const marker of UNFINISHED_MARKERS) {
    const exists = yield* fileSystem
      .exists(path.join(gitDir.stdout.trim(), marker))
      .pipe(Effect.orElseSucceed(() => false));
    if (exists) return true;
  }
  return false;
});

export type AutosaveResult =
  | { readonly status: "saved"; readonly commit: string; readonly files: ReadonlyArray<string> }
  | { readonly status: "nothing" }
  | { readonly status: "secret"; readonly files: ReadonlyArray<string> }
  | { readonly status: "unfinished-merge" }
  | { readonly status: "scan-failed" };

const notesChangedLine = (count: number) =>
  count === 1 ? "1 note changed." : `${count} notes changed.`;

export const autosaveVault = Effect.fn("majordome.autosaveVault")(function* (input: {
  readonly cwd: string;
  /** The gitleaks executable, or null when it is not installed. */
  readonly gitleaks: string | null;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const isRepo = yield* git.execute({
    operation: "majordome.autosave",
    cwd: input.cwd,
    args: ["rev-parse", "--is-inside-work-tree"],
    allowNonZeroExit: true,
  });
  if (isRepo.exitCode !== 0) return { status: "nothing" } as AutosaveResult;
  if (yield* hasUnfinishedMerge(input.cwd)) return { status: "unfinished-merge" } as AutosaveResult;

  const identity = yield* ownerIdentity(input.cwd);
  const run = (args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    git.execute({
      operation: "majordome.autosave",
      cwd: input.cwd,
      args,
      allowNonZeroExit,
      env: identityEnv(identity),
    });
  // A vault with no commit yet has no HEAD to reset to.
  const unstage = run(["reset", "--quiet"], true).pipe(
    Effect.flatMap((reset) =>
      reset.exitCode === 0
        ? Effect.void
        : run(["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "."], true),
    ),
    Effect.ignore,
  );

  yield* run(["add", "--all"]);
  const staged = yield* run(["diff", "--cached", "--quiet"], true);
  if (staged.exitCode === 0) return { status: "nothing" } as AutosaveResult;
  const files = listLines((yield* run(["diff", "--cached", "--name-only"])).stdout);

  if (input.gitleaks !== null) {
    const scan = yield* scanForSecrets({
      gitleaks: input.gitleaks,
      cwd: input.cwd,
      target: { staged: true },
    });
    if (scan.status !== "clean") {
      yield* unstage;
      return (
        scan.status === "found"
          ? { status: "secret", files: scan.files }
          : { status: "scan-failed" }
      ) as AutosaveResult;
    }
  }

  // The owner's own hooks run, as they would for a commit the owner made.
  // Unsigned: an automatic save can never answer a signing prompt (SSH or GPG agents).
  yield* run([
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--message",
    YOUR_EDITS_SUBJECT,
    "--message",
    notesChangedLine(files.length),
  ]).pipe(Effect.tapError(() => unstage));
  const head = yield* run(["rev-parse", "HEAD"]);
  return { status: "saved", commit: head.stdout.trim(), files } as AutosaveResult;
});
