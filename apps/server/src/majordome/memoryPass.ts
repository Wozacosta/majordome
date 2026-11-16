/**
 * Decides, without starting a model, whether a vault's nightly memory pass has anything to do:
 * notes that changed since the last pass, or a memory note over its limit. The changes come from
 * the vault's history; what Majordome's own routines wrote from notes already there doesn't count.
 */

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { MEMORY_CHAR_LIMIT } from "./memoryPassPrompt.ts";
import type { MemoryPassState } from "./memoryPassState.ts";
import type { VaultLayout } from "./vaultConfig.ts";
import { readMemoryChars } from "./vaultContext.ts";
import { listVaultHistory, type VaultHistoryEntry } from "./vaultHistory.ts";
import { routineOf } from "./vaultRunSummaries.ts";

const FIRST_PASS_LOOKBACK_DAYS = 7;
const FILES_LISTED = 40;
const COMMITS_READ = 500;
/** These read the vault and write from it, so their runs bring nothing new to remember. */
const DERIVED_ROUTINES: ReadonlySet<string> = new Set([
  "start-my-day",
  "review-my-week",
  "tidy-my-memory",
]);
const INSTRUCTION_FILES: ReadonlySet<string> = new Set(["CLAUDE.md", "AGENTS.md"]);

const runSubject = (title: string) => `majordome: ${title.replaceAll(/\s+/g, " ").trim()}`;

function bringsNothingNew(entry: VaultHistoryEntry, passTitle: string): boolean {
  if (!entry.byMajordome) return false;
  if (entry.subject.startsWith("Undo: ") || entry.subject === runSubject(passTitle)) return true;
  const routine = routineOf({ scheduledTaskId: undefined, subject: entry.subject });
  return routine !== null && DERIVED_ROUTINES.has(routine);
}

/** Paths from `git status --porcelain -z`; a rename's old path follows it and is skipped. */
function unsavedPaths(stdout: string): ReadonlyArray<string> {
  const paths: Array<string> = [];
  const tokens = stdout.split("\u0000");
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (token.length < 4) continue;
    paths.push(token.slice(3));
    if (token[0] === "R" || token[0] === "C") index++;
  }
  return paths;
}

/**
 * The next pass's state, or null when there is nothing to do. `previous` is the pass before; with
 * none, or one whose commit this vault no longer has, the last week counts as new.
 */
export const planMemoryPass = Effect.fn("majordome.planMemoryPass")(function* (input: {
  readonly vaultRoot: string;
  readonly layout: VaultLayout;
  readonly previous: Option.Option<MemoryPassState>;
  /** The routine's title now, which names its runs in the vault's history. */
  readonly passTitle: string;
  readonly now: DateTime.Utc;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const run = (args: ReadonlyArray<string>) =>
    git.execute({
      operation: "majordome.memoryPass",
      cwd: input.vaultRoot,
      args,
      allowNonZeroExit: true,
    });

  const headResult = yield* run(["rev-parse", "--verify", "--quiet", "HEAD"]);
  const head = headResult.exitCode === 0 ? headResult.stdout.trim() : "";
  const previous = Option.getOrUndefined(input.previous);
  const previousKnown =
    previous !== undefined &&
    previous.head !== "" &&
    (yield* run(["cat-file", "-e", `${previous.head}^{commit}`])).exitCode === 0;
  const entries =
    head === ""
      ? []
      : yield* listVaultHistory({
          cwd: input.vaultRoot,
          limit: COMMITS_READ,
          after: previousKnown
            ? { commit: previous.head }
            : {
                sinceIso: DateTime.formatIso(
                  DateTime.subtract(input.now, { days: FIRST_PASS_LOOKBACK_DAYS }),
                ),
              },
        });
  const unsaved = unsavedPaths(
    (yield* run(["status", "--porcelain", "--untracked-files=all", "-z"])).stdout,
  );

  const candidates = new Set([
    ...unsaved,
    ...entries
      .filter((entry) => !bringsNothingNew(entry, input.passTitle))
      .flatMap((entry) => entry.files),
  ]);
  const notes: Array<string> = [];
  for (const file of candidates) {
    if (
      !file.endsWith(".md") ||
      file.startsWith(".majordome/") ||
      file === input.layout.memory ||
      INSTRUCTION_FILES.has(path.basename(file))
    ) {
      continue;
    }
    const exists = yield* fileSystem
      .exists(path.join(input.vaultRoot, file))
      .pipe(Effect.orElseSucceed(() => false));
    if (exists) notes.push(file);
  }

  const memoryChars = yield* readMemoryChars({
    vaultRoot: input.vaultRoot,
    memoryPath: input.layout.memory,
  });
  if (notes.length === 0 && memoryChars <= MEMORY_CHAR_LIMIT) return null;
  return {
    head,
    brief: {
      since: previousKnown ? previous.brief.preparedAt : null,
      preparedAt: DateTime.formatIso(input.now),
      files: notes.slice(0, FILES_LISTED),
      more: Math.max(0, notes.length - FILES_LISTED),
      memoryChars,
    },
  } satisfies MemoryPassState;
});
