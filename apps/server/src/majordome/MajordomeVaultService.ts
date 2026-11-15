/**
 * The feed's view of a project's vault: its history, which server runs its routines, and "Undo
 * this", looked up by project so clients never name a folder on the server.
 */

import {
  MajordomeVaultError,
  type MajordomeVaultHistoryInput,
  type MajordomeVaultHistoryResult,
  type MajordomeVaultUndoInput,
  type MajordomeVaultUndoResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { readVaultLayout } from "./vaultConfig.ts";
import { listVaultHistory, undoVaultCommit } from "./vaultHistory.ts";
import * as VaultLock from "./VaultLock.ts";
import { readVaultRunner } from "./vaultRunner.ts";
import { describeVaultHistory } from "./vaultRunSummaries.ts";

const DEFAULT_HISTORY_LIMIT = 100;

export class MajordomeVaultService extends Context.Service<
  MajordomeVaultService,
  {
    readonly listHistory: (
      input: MajordomeVaultHistoryInput,
    ) => Effect.Effect<MajordomeVaultHistoryResult, MajordomeVaultError>;
    readonly undo: (
      input: MajordomeVaultUndoInput,
    ) => Effect.Effect<MajordomeVaultUndoResult, MajordomeVaultError>;
  }
>()("t3/majordome/MajordomeVaultService") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = yield* Effect.context<GitVcsDriver.GitVcsDriver>();
  const vaultLock = yield* VaultLock.VaultLock;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const toVaultError = (message: string) => (cause: unknown) =>
    new MajordomeVaultError({ message, cause });

  /** The project's folder when it is a vault, otherwise undefined. */
  const vaultRoot = Effect.fn("MajordomeVaultService.vaultRoot")(function* (
    projectId: MajordomeVaultHistoryInput["projectId"],
  ) {
    const project = Option.getOrUndefined(yield* projects.get(projectId));
    if (project === undefined) return undefined;
    const isVault = yield* fileSystem
      .exists(path.join(project.workspaceRoot, ".majordome"))
      .pipe(Effect.orElseSucceed(() => false));
    return isVault ? project.workspaceRoot : undefined;
  });

  const listHistory: MajordomeVaultService["Service"]["listHistory"] = Effect.fn(
    "MajordomeVaultService.listHistory",
  )(
    function* (input) {
      const cwd = yield* vaultRoot(input.projectId);
      if (cwd === undefined) {
        return { isVault: false, entries: [], routinesRunner: "none" as const };
      }
      const history = yield* listVaultHistory({
        cwd,
        limit: input.limit ?? DEFAULT_HISTORY_LIMIT,
      }).pipe(Effect.provide(services));
      const layout = Option.getOrElse(
        yield* readVaultLayout(cwd).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
        () => ({
          memory: "memory.md",
          dailyFolder: "daily",
          inboxFolder: "inbox",
          projectsFolder: "projects",
        }),
      );
      const { entries, notes } = yield* describeVaultHistory({
        cwd,
        layout,
        entries: history,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ProjectionStore.ProjectionStoreV2, projections),
      );
      // Read only: looking at the feed must not claim the vault for this server.
      const runner = yield* readVaultRunner(cwd).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      const environmentId = yield* environment.getEnvironmentId;
      const routinesRunner = Option.match(runner, {
        onNone: () => "none" as const,
        onSome: (id) =>
          id === environmentId ? ("this-server" as const) : ("another-server" as const),
      });
      return {
        isVault: true,
        entries,
        routinesRunner,
        folders: { daily: layout.dailyFolder, inbox: layout.inboxFolder },
        notes,
      };
    },
    Effect.mapError(toVaultError("Could not read this vault's history.")),
  );

  const undo: MajordomeVaultService["Service"]["undo"] = Effect.fn("MajordomeVaultService.undo")(
    function* (input) {
      const cwd = yield* vaultRoot(input.projectId);
      if (cwd === undefined) return { status: "not-found" } as const;
      return yield* vaultLock.withLock(
        cwd,
        undoVaultCommit({ cwd, commit: input.commit }).pipe(Effect.provide(services)),
      );
    },
    Effect.mapError(toVaultError("Could not undo this run.")),
  );

  return MajordomeVaultService.of({ listHistory, undo });
});

export const layer = Layer.effect(MajordomeVaultService, make);
