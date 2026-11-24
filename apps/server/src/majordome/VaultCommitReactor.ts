/**
 * Every agent run in a Majordome vault ends as one git commit, so the vault's history shows what
 * each run changed and any run can be undone. Commits are authored by Majordome to keep them apart
 * from the user's own. Nothing is pushed here.
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { isTerminalRunStatus } from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as MajordomeNotesSearch from "./MajordomeNotesSearch.ts";
import * as VaultLock from "./VaultLock.ts";
import { holdBackRunChanges } from "./vaultSkills.ts";

export const MAJORDOME_AUTHOR = { name: "Majordome", email: "majordome@localhost" };
/** Git trailer that links a run's commit back to its thread. */
export const MAJORDOME_THREAD_TRAILER = "Majordome-Thread";

export function vaultCommitMessage(input: {
  readonly threadTitle: string;
  readonly runOrdinal: number;
  readonly threadId: string;
}): string {
  const title = input.threadTitle.replaceAll(/\s+/g, " ").trim() || "Untitled thread";
  return `majordome: ${title}\n\nRun ${input.runOrdinal} of this thread.\n\n${MAJORDOME_THREAD_TRAILER}: ${input.threadId}`;
}

/** True when it made a commit; false when the folder is not a vault or nothing changed. */
export const commitVaultRun = Effect.fn("majordome.commitVaultRun")(function* (input: {
  readonly cwd: string;
  readonly message: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const isVault = yield* fileSystem
    .exists(path.join(input.cwd, ".majordome"))
    .pipe(Effect.orElseSucceed(() => false));
  if (!isVault) return false;

  const run = (args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    git.execute({
      operation: "majordome.vaultCommit",
      cwd: input.cwd,
      args,
      allowNonZeroExit,
      env: {
        GIT_AUTHOR_NAME: MAJORDOME_AUTHOR.name,
        GIT_AUTHOR_EMAIL: MAJORDOME_AUTHOR.email,
        GIT_COMMITTER_NAME: MAJORDOME_AUTHOR.name,
        GIT_COMMITTER_EMAIL: MAJORDOME_AUTHOR.email,
      },
    });

  const held = yield* holdBackRunChanges(input.cwd);
  if (held.files.length > 0) {
    yield* Effect.logWarning(
      "Majordome held back a run's changes to files that steer later runs.",
      {
        count: held.files.length,
        files: held.files.slice(0, 20),
      },
    );
  }
  yield* run(["add", "--all"]);
  const staged = yield* run(["diff", "--cached", "--quiet"], true);
  if (staged.exitCode === 0) return false;
  // The user's own hooks are for the user's commits.
  // Majordome commits on its own, so it can never answer a signing prompt (SSH or GPG agents).
  yield* run([
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--no-verify",
    "--message",
    input.message,
  ]);
  return true;
});

export class VaultCommitReactor extends Context.Service<
  VaultCommitReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("t3/majordome/VaultCommitReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const services = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | GitVcsDriver.GitVcsDriver
  >();
  // Runs in two threads of one vault can end together; git allows one commit at a time.
  const vaultLock = yield* VaultLock.VaultLock;
  const notesSearch = yield* MajordomeNotesSearch.MajordomeNotesSearch;

  const commitRun = Effect.fn("VaultCommitReactor.commitRun")(function* (
    threadId: Parameters<typeof projections.getThreadShell>[0],
    runOrdinal: number,
  ) {
    const thread = yield* projections.getThreadShell(threadId);
    if (thread === null) return;
    const cwd =
      thread.worktreePath ??
      Option.getOrUndefined(yield* projects.get(thread.projectId))?.workspaceRoot;
    if (cwd === undefined) return;
    // Whether or not the commit works, the run may have written notes.
    yield* notesSearch.refreshInBackground(cwd);
    yield* vaultLock.withLock(
      cwd,
      commitVaultRun({
        cwd,
        message: vaultCommitMessage({ threadTitle: thread.title, runOrdinal, threadId }),
      }).pipe(Effect.provide(services)),
    );
  });

  const start: VaultCommitReactor["Service"]["start"] = Effect.fn("VaultCommitReactor.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          event.type === "run.updated" && isTerminalRunStatus(event.payload.status)
            ? commitRun(event.threadId, event.payload.ordinal).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Majordome could not commit a vault run.", {
                    threadId: event.threadId,
                    cause,
                  }),
                ),
              )
            : Effect.void,
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Majordome's vault commit stream stopped.", { cause }),
          ),
        ),
      );
    },
  );

  return VaultCommitReactor.of({ start });
});

export const layer = Layer.effect(VaultCommitReactor, make);
