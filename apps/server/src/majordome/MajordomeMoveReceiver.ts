/**
 * The receiving end of "Set up a server for me": what a new server does when the owner's
 * computer hands it the notes. It takes the whole history as one git bundle, opens it as the
 * notes folder, and can hand its own history back before it is removed.
 */

import { CommandId, ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { GITHUB_TOKEN_SECRET } from "./MajordomeBackup.ts";
import * as MajordomeRoutines from "./MajordomeRoutines.ts";
import { autosaveVault } from "./vaultAutosave.ts";
import { readVaultBrainId } from "./vaultBrainId.ts";
import { createVaultBundle } from "./vaultFolderBackup.ts";
import * as VaultLock from "./VaultLock.ts";
import { isProviderReady } from "./vaultModel.ts";
import { readVaultRunner } from "./vaultRunner.ts";
import { findGitleaks } from "./vaultSecretScan.ts";

/** Where the image keeps the notes, by the always-on guide's convention: `/data/brain`. */
const NOTES_DIRNAME = "brain";
const INCOMING_REF = "refs/majordome/incoming";

export class MoveReceiverError extends Schema.TaggedError<MoveReceiverError>()(
  "MoveReceiverError",
  {
    reason: Schema.Literals(["other-notes", "diverged", "no-notes", "failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "other-notes":
        return "The server already holds different notes, so these were not copied over them.";
      case "diverged":
        return "The notes on the server have changes this computer does not have, so they were left as they are.";
      case "no-notes":
        return "The server has no notes yet.";
      case "failed":
        return "The server could not take the notes.";
    }
  }
}

export const ReceivedVault = Schema.Struct({
  projectId: ProjectId,
  /** The commit the notes folder is at. */
  head: Schema.String,
  /** The first commit of its history, which every copy of the same notes shares. */
  brainId: Schema.String,
});
export type ReceivedVault = typeof ReceivedVault.Type;

export const ReceiverRoutines = Schema.Struct({
  /** A provider is signed in and ready, so routines moved here would run. */
  canRun: Schema.Boolean,
  /** This server is the one running the notes' routines. */
  runsHere: Schema.Boolean,
});
export type ReceiverRoutines = typeof ReceiverRoutines.Type;

export interface ReceiveVaultInput {
  /** A `git bundle` of the whole history, already on this server's disk. */
  readonly bundlePath: string;
  readonly title: string;
  /** The remote the notes are backed up to, set here too so both copies stay in step. */
  readonly remote?: { readonly name: string; readonly url: string };
  /** The owner's name on their own edits. */
  readonly identity?: { readonly name: string; readonly email: string };
}

export class MajordomeMoveReceiver extends Context.Service<
  MajordomeMoveReceiver,
  {
    readonly receiveVault: (
      input: ReceiveVaultInput,
    ) => Effect.Effect<ReceivedVault, MoveReceiverError>;
    /** Writes this server's notes, saved first, to `bundlePath`. */
    readonly sendVault: (bundlePath: string) => Effect.Effect<void, MoveReceiverError>;
    readonly setGitHubToken: (token: string) => Effect.Effect<void, MoveReceiverError>;
    readonly routines: () => Effect.Effect<ReceiverRoutines, MoveReceiverError>;
    readonly runRoutinesHere: () => Effect.Effect<void, MoveReceiverError>;
  }
>()("t3/majordome/MajordomeMoveReceiver") {}

const isMoveReceiverError = Schema.is(MoveReceiverError);
const failed = (cause: unknown) =>
  isMoveReceiverError(cause) ? cause : new MoveReceiverError({ reason: "failed", cause });

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const routinesService = yield* MajordomeRoutines.MajordomeRoutines;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const vaultLock = yield* VaultLock.VaultLock;
  const random = yield* SecureRandom.SecureRandom;
  const services = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | GitVcsDriver.GitVcsDriver | ProcessRunner.ProcessRunner
  >();
  const notesPath = path.join(yield* HostProcess.HomeDirectory, NOTES_DIRNAME);

  const run = (cwd: string, args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    git.execute({
      operation: "majordome.moveReceiver",
      cwd,
      args,
      allowNonZeroExit,
      timeoutMs: 10 * 60_000,
    });

  const hasNotes = Effect.gen(function* () {
    if (!(yield* fileSystem.exists(notesPath))) return false;
    return (yield* fileSystem.readDirectory(notesPath)).length > 0;
  });

  const requireProject = Effect.gen(function* () {
    const project = yield* projects.getByWorkspaceRoot(notesPath);
    if (Option.isNone(project)) return yield* new MoveReceiverError({ reason: "no-notes" });
    return project.value;
  });

  const receiveVault: MajordomeMoveReceiver["Service"]["receiveVault"] = Effect.fn(
    "MajordomeMoveReceiver.receiveVault",
  )(function* (input) {
    if (yield* hasNotes) {
      // A second try after a cut-off first one: only the same notes, and only forward.
      const local = yield* readVaultBrainId(notesPath).pipe(Effect.provide(services));
      yield* run(notesPath, ["fetch", "--quiet", input.bundlePath, `+HEAD:${INCOMING_REF}`]);
      const incoming = yield* run(notesPath, [
        "rev-list",
        "--first-parent",
        "--max-parents=0",
        INCOMING_REF,
      ]);
      if (local === null || incoming.stdout.trim().split("\n").at(-1) !== local) {
        return yield* new MoveReceiverError({ reason: "other-notes" });
      }
      const merged = yield* vaultLock.withLock(
        notesPath,
        run(notesPath, ["merge", "--quiet", "--ff-only", INCOMING_REF], true),
      );
      if (merged.exitCode !== 0) return yield* new MoveReceiverError({ reason: "diverged" });
    } else {
      const parent = path.dirname(notesPath);
      yield* fileSystem.makeDirectory(parent, { recursive: true });
      yield* run(parent, ["clone", "--quiet", input.bundlePath, notesPath]);
      // The clone's origin is the bundle file, which is about to be deleted.
      yield* run(notesPath, ["remote", "remove", "origin"], true);
    }
    if (input.identity !== undefined) {
      yield* run(notesPath, ["config", "user.name", input.identity.name]);
      yield* run(notesPath, ["config", "user.email", input.identity.email]);
    }
    if (input.remote !== undefined) {
      const known = yield* run(notesPath, ["remote", "get-url", input.remote.name], true);
      yield* run(
        notesPath,
        known.exitCode === 0
          ? ["remote", "set-url", input.remote.name, input.remote.url]
          : ["remote", "add", input.remote.name, input.remote.url],
      );
    }
    const head = (yield* run(notesPath, ["rev-parse", "HEAD"])).stdout.trim();
    const brainId = yield* readVaultBrainId(notesPath).pipe(Effect.provide(services));
    if (brainId === null) return yield* new MoveReceiverError({ reason: "failed" });

    const existing = yield* projects.getByWorkspaceRoot(notesPath);
    const project = Option.isSome(existing)
      ? existing.value
      : // Requests are only served once the server takes commands, so this needs no queue.
        yield* projects.create({
          commandId: CommandId.make(`majordome:move:receive:${yield* random.uuidV4()}`),
          projectId: ProjectId.make(yield* random.uuidV4()),
          title: input.title,
          workspaceRoot: notesPath,
        });
    return { projectId: project.id, head, brainId };
  }, Effect.mapError(failed));

  const sendVault: MajordomeMoveReceiver["Service"]["sendVault"] = Effect.fn(
    "MajordomeMoveReceiver.sendVault",
  )(function* (bundlePath) {
    if (!(yield* hasNotes)) return yield* new MoveReceiverError({ reason: "no-notes" });
    const gitleaks = yield* findGitleaks().pipe(Effect.provide(services));
    yield* vaultLock.withLock(
      notesPath,
      Effect.gen(function* () {
        // Edits made here since the last save travel too; a paused save sends what is committed.
        yield* autosaveVault({ cwd: notesPath, gitleaks }).pipe(Effect.ignore);
        yield* createVaultBundle({ cwd: notesPath, bundlePath });
      }).pipe(Effect.provide(services)),
    );
  }, Effect.mapError(failed));

  const setGitHubToken: MajordomeMoveReceiver["Service"]["setGitHubToken"] = (token) =>
    secrets
      .set(GITHUB_TOKEN_SECRET, new TextEncoder().encode(token))
      .pipe(Effect.mapError(failed), Effect.withSpan("MajordomeMoveReceiver.setGitHubToken"));

  const routines: MajordomeMoveReceiver["Service"]["routines"] = Effect.fn(
    "MajordomeMoveReceiver.routines",
  )(function* () {
    const runner = yield* readVaultRunner(notesPath).pipe(Effect.provide(services));
    return {
      canRun: (yield* providers.getProviders).some(isProviderReady),
      runsHere: Option.getOrUndefined(runner) === (yield* environment.getEnvironmentId),
    };
  }, Effect.mapError(failed));

  const runRoutinesHere: MajordomeMoveReceiver["Service"]["runRoutinesHere"] = Effect.fn(
    "MajordomeMoveReceiver.runRoutinesHere",
  )(function* () {
    yield* routinesService.runHere((yield* requireProject).id);
  }, Effect.mapError(failed));

  return MajordomeMoveReceiver.of({
    receiveVault,
    sendVault,
    setGitHubToken,
    routines,
    runRoutinesHere,
  });
});

export const layer = Layer.effect(MajordomeMoveReceiver, make);
