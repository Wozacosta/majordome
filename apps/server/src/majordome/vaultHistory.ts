/**
 * A vault's history as the feed shows it, and "Undo this": a revert committed on top, never a
 * rewrite. Undo refuses, and leaves the vault as it was, when later changes touched the same lines.
 */

import * as Effect from "effect/Effect";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { MAJORDOME_AUTHOR, MAJORDOME_THREAD_TRAILER } from "./VaultCommitReactor.ts";

export interface VaultHistoryEntry {
  readonly commit: string;
  readonly subject: string;
  readonly body: string;
  readonly authorName: string;
  readonly committedAt: string;
  /** True for the runs Majordome committed; false for the owner's own commits. */
  readonly byMajordome: boolean;
  /** The thread whose run made this commit, from its trailer; null for other commits. */
  readonly threadId: string | null;
  readonly files: ReadonlyArray<string>;
}

export type VaultUndoResult =
  | { readonly status: "undone"; readonly commit: string }
  | { readonly status: "conflict"; readonly files: ReadonlyArray<string> }
  | { readonly status: "unsaved-changes"; readonly files: ReadonlyArray<string> }
  | { readonly status: "not-found" };

const FIELD = "\u001f";
const RECORD = "\u001e";
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/;

const THREAD_TRAILER_LINE = new RegExp(`^${MAJORDOME_THREAD_TRAILER}:[ \\t]*(\\S+)[ \\t]*$`, "m");

function splitThreadTrailer(rawBody: string) {
  const match = THREAD_TRAILER_LINE.exec(rawBody);
  if (match === null) return { body: rawBody.trim(), threadId: null };
  return {
    body: (rawBody.slice(0, match.index) + rawBody.slice(match.index + match[0].length)).trim(),
    threadId: match[1] ?? null,
  };
}

const majordomeEnv = {
  GIT_AUTHOR_NAME: MAJORDOME_AUTHOR.name,
  GIT_AUTHOR_EMAIL: MAJORDOME_AUTHOR.email,
  GIT_COMMITTER_NAME: MAJORDOME_AUTHOR.name,
  GIT_COMMITTER_EMAIL: MAJORDOME_AUTHOR.email,
};

function parseVaultLog(stdout: string): ReadonlyArray<VaultHistoryEntry> {
  return stdout
    .split(RECORD)
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [
        commit = "",
        authorName = "",
        authorEmail = "",
        committedAt = "",
        subject = "",
        rest = "",
      ] = record.split(FIELD);
      const [rawBody = "", fileList = ""] = rest.split("\u0000");
      const { body, threadId } = splitThreadTrailer(rawBody);
      return {
        commit,
        subject,
        body,
        authorName,
        committedAt,
        byMajordome: authorEmail === MAJORDOME_AUTHOR.email,
        threadId,
        files: fileList
          .split("\n")
          .map((file) => file.trim())
          .filter((file) => file !== ""),
      };
    });
}

export const listVaultHistory = Effect.fn("majordome.listVaultHistory")(function* (input: {
  readonly cwd: string;
  readonly limit: number;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* git.execute({
    operation: "majordome.vaultHistory",
    cwd: input.cwd,
    args: [
      "log",
      `--max-count=${Math.max(1, Math.min(input.limit, 500))}`,
      "--name-only",
      `--format=${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%cI${FIELD}%s${FIELD}%b%x00`,
    ],
    allowNonZeroExit: true,
  });
  // A vault with no commits yet has no history.
  return result.exitCode === 0 ? parseVaultLog(result.stdout) : [];
});

const listFiles = (stdout: string) =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

export const undoVaultCommit = Effect.fn("majordome.undoVaultCommit")(function* (input: {
  readonly cwd: string;
  readonly commit: string;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const run = (args: ReadonlyArray<string>) =>
    git.execute({
      operation: "majordome.vaultUndo",
      cwd: input.cwd,
      args,
      allowNonZeroExit: true,
      env: majordomeEnv,
    });

  if (!COMMIT_PATTERN.test(input.commit)) return { status: "not-found" } as VaultUndoResult;
  const subject = yield* run(["log", "-1", "--format=%s", `${input.commit}^{commit}`, "--"]);
  if (subject.exitCode !== 0) return { status: "not-found" } as VaultUndoResult;

  // Undo commits on top of the vault, so unsaved edits in the same notes would be mixed in.
  const touched = listFiles(
    (yield* run(["show", "--format=", "--name-only", input.commit])).stdout,
  );
  const unsaved = (yield* run(["status", "--porcelain", "--", ...touched])).stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3));
  if (unsaved.length > 0) {
    return {
      status: "unsaved-changes",
      files: unsaved,
    } as VaultUndoResult;
  }

  const revert = yield* run(["revert", "--no-commit", input.commit]);
  if (revert.exitCode !== 0) {
    const conflicted = listFiles((yield* run(["diff", "--name-only", "--diff-filter=U"])).stdout);
    yield* run(["revert", "--abort"]);
    return { status: "conflict", files: conflicted } as VaultUndoResult;
  }
  // Unsigned: an undo commit can't wait on a signing prompt (SSH or GPG agents).
  yield* run([
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--no-verify",
    "--allow-empty",
    "--message",
    `Undo: ${subject.stdout.trim()}\n\nReverts ${input.commit}.`,
  ]);
  const head = yield* run(["rev-parse", "HEAD"]);
  return { status: "undone", commit: head.stdout.trim() } as VaultUndoResult;
});
