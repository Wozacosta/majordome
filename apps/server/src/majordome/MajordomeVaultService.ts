/**
 * The feed's view of a project's vault: its history, which server runs its routines, the limits on
 * unattended runs, "Undo this", and when its notes change, looked up by project so clients never
 * name a folder on the server.
 */

import {
  type MajordomeVaultChangesInput,
  type MajordomeRoutineLimits,
  type MajordomeSetRoutineLimitsInput,
  type MajordomeRestoreNotesInput,
  type MajordomeRestoreNotesResult,
  type MajordomeStartNotesInput,
  type MajordomeStartNotesResult,
  MajordomeVaultError,
  ProjectId,
  CommandId,
  type MajordomeVaultHistoryInput,
  type MajordomeVaultHistoryResult,
  type MajordomeVaultUndoInput,
  type MajordomeVaultUndoResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { VAULT_CHANGES_QUIET_PERIOD, vaultChangeRevisions } from "./vaultChanges.ts";
import { routineLedgerPath, routineTaskId } from "./defaultRoutines.ts";
import * as MajordomeNotesSearch from "./MajordomeNotesSearch.ts";
import { MEMORY_CHAR_LIMIT } from "./memoryPassPrompt.ts";
import * as RoutineRunLedger from "./RoutineRunLedger.ts";
import { readRoutinesStatus } from "./routinesStatus.ts";
import { isTooBroadForNotes, NotesFolderError, setUpNotesFolder } from "./starterNotes.ts";
import { findBackupFile, FolderBackupError, restoreFolderBackup } from "./vaultFolderBackup.ts";
import { readVaultLayout, readVaultLimits, writeVaultLimits } from "./vaultConfig.ts";
import { listVaultHistory, undoVaultCommit } from "./vaultHistory.ts";
import * as VaultLock from "./VaultLock.ts";
import { readMemoryChars } from "./vaultContext.ts";
import { readVaultRunner } from "./vaultRunner.ts";
import { describeVaultHistory } from "./vaultRunSummaries.ts";

const DEFAULT_HISTORY_LIMIT = 100;
const isVaultError = Schema.is(MajordomeVaultError);
/** Under the home folder, not Documents: macOS asks before a background service may read that. */
const DEFAULT_NOTES_FOLDER = "Majordome";
const isNotesFolderError = Schema.is(NotesFolderError);
const isFolderBackupError = Schema.is(FolderBackupError);

export class MajordomeVaultService extends Context.Service<
  MajordomeVaultService,
  {
    readonly listHistory: (
      input: MajordomeVaultHistoryInput,
    ) => Effect.Effect<MajordomeVaultHistoryResult, MajordomeVaultError>;
    readonly undo: (
      input: MajordomeVaultUndoInput,
    ) => Effect.Effect<MajordomeVaultUndoResult, MajordomeVaultError>;
    /** Nothing for a project that is not a vault. */
    readonly changes: (
      input: MajordomeVaultChangesInput,
    ) => Stream.Stream<number, MajordomeVaultError>;
    readonly setRoutineLimits: (
      input: MajordomeSetRoutineLimitsInput,
    ) => Effect.Effect<MajordomeRoutineLimits, MajordomeVaultError>;
    /** Makes a folder a notes folder, keeping what it holds, and opens it as a project. */
    readonly startNotes: (
      input: MajordomeStartNotesInput,
    ) => Effect.Effect<MajordomeStartNotesResult, MajordomeVaultError>;
    /** Opens an encrypted backup into a new folder and opens that folder as the notes. */
    readonly restoreNotes: (
      input: MajordomeRestoreNotesInput,
    ) => Effect.Effect<MajordomeRestoreNotesResult, MajordomeVaultError>;
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
  const runLedger = yield* RoutineRunLedger.RoutineRunLedger;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const notesSearch = yield* MajordomeNotesSearch.MajordomeNotesSearch;
  const random = yield* SecureRandom.SecureRandom;
  const projectService = yield* ProjectService.ProjectService;
  const ledgerPath = routineLedgerPath(path, (yield* ServerConfig.ServerConfig).stateDir);

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
      const routineLimits = yield* readVaultLimits(cwd).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      const { pausedToday, stoppedRuns } = yield* runLedger.read(input.projectId);
      const routinesStatus =
        routinesRunner === "this-server"
          ? yield* readRoutinesStatus({ ledgerPath, projectId: input.projectId }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(ScheduledTaskService.ScheduledTaskService, scheduledTasks),
              Effect.provideService(ProviderRegistry.ProviderRegistry, providers),
            )
          : undefined;
      const memoryChars = yield* readMemoryChars({
        vaultRoot: cwd,
        memoryPath: layout.memory,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      const tidyId = routineTaskId(input.projectId, "tidy-my-memory");
      const memoryOverLimit =
        memoryChars > MEMORY_CHAR_LIMIT
          ? {
              tidyRoutineOn: (yield* scheduledTasks.list()).tasks.some(
                (task) => task.id === tidyId && task.enabled,
              ),
            }
          : undefined;
      return {
        isVault: true,
        entries,
        routinesRunner,
        ...(routinesStatus === undefined ? {} : { routinesStatus }),
        ...(memoryOverLimit === undefined ? {} : { memoryOverLimit }),
        folders: { daily: layout.dailyFolder, inbox: layout.inboxFolder },
        notes,
        routineLimits,
        pausedToday,
        stoppedRuns,
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

  const changes: MajordomeVaultService["Service"]["changes"] = (input) =>
    Stream.unwrap(
      vaultRoot(input.projectId).pipe(
        Effect.map((cwd) =>
          cwd === undefined
            ? Stream.empty
            : vaultChangeRevisions(
                fileSystem.watch(cwd, { recursive: true }),
                VAULT_CHANGES_QUIET_PERIOD,
              ).pipe(Stream.tap(() => notesSearch.refreshInBackground(cwd))),
        ),
      ),
    ).pipe(Stream.mapError(toVaultError("Could not watch this vault for changes.")));

  const setRoutineLimits: MajordomeVaultService["Service"]["setRoutineLimits"] = Effect.fn(
    "MajordomeVaultService.setRoutineLimits",
  )(
    function* (input) {
      const cwd = yield* vaultRoot(input.projectId);
      if (cwd === undefined) {
        return yield* new MajordomeVaultError({ message: "That project is not a vault." });
      }
      yield* writeVaultLimits(cwd, input.limits).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      return input.limits;
    },
    Effect.mapError((cause) =>
      isVaultError(cause)
        ? cause
        : new MajordomeVaultError({ message: "Could not save the limits.", cause }),
    ),
  );

  const startNotes: MajordomeVaultService["Service"]["startNotes"] = Effect.fn(
    "MajordomeVaultService.startNotes",
  )(
    function* (input) {
      const home = yield* HostProcess.HomeDirectory;
      const folder = path.resolve(input.folder ?? path.join(home, DEFAULT_NOTES_FOLDER));
      if (input.folder !== null && !path.isAbsolute(input.folder)) {
        return yield* new MajordomeVaultError({ message: "Give the folder's full path." });
      }
      if (isTooBroadForNotes({ folder, home, path })) {
        return yield* new MajordomeVaultError({
          message: "That folder holds more than notes. Pick a folder used only for your notes.",
        });
      }
      yield* vaultLock.withLock(
        folder,
        setUpNotesFolder(folder).pipe(
          Effect.provide(services),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      );
      const existing = yield* projectService.getByWorkspaceRoot(folder);
      const project = Option.isSome(existing)
        ? existing.value
        : yield* projectService.create({
            commandId: CommandId.make(`majordome:start-notes:${yield* random.uuidV4()}`),
            projectId: ProjectId.make(yield* random.uuidV4()),
            title: path.basename(folder),
            workspaceRoot: folder,
          });
      return { projectId: project.id, folder };
    },
    Effect.mapError((cause) =>
      isVaultError(cause)
        ? cause
        : new MajordomeVaultError({
            message: isNotesFolderError(cause)
              ? "That folder is part of another project. Pick a folder of its own."
              : "Could not set up that folder for your notes.",
            cause,
          }),
    ),
  );

  const restoreNotes: MajordomeVaultService["Service"]["restoreNotes"] = Effect.fn(
    "MajordomeVaultService.restoreNotes",
  )(
    function* (input) {
      const home = yield* HostProcess.HomeDirectory;
      if (input.into !== null && !path.isAbsolute(input.into)) {
        return yield* new MajordomeVaultError({ message: "Give the folder's full path." });
      }
      const into = path.resolve(input.into ?? home);
      const place = yield* fileSystem.stat(into).pipe(Effect.option);
      if (Option.isNone(place) || place.value.type !== "Directory") {
        return yield* new MajordomeVaultError({
          message: "The folder you chose for your notes does not exist on this computer.",
        });
      }
      const withFiles = Effect.provideService(FileSystem.FileSystem, fileSystem);
      const withPath = Effect.provideService(Path.Path, path);
      const file = yield* findBackupFile({ source: input.source, homeDirectory: home }).pipe(
        withFiles,
        withPath,
      );
      const folder = yield* restoreFolderBackup({
        file,
        passphrase: input.passphrase,
        into,
        name: DEFAULT_NOTES_FOLDER,
      }).pipe(Effect.provide(services), withFiles, withPath);
      yield* vaultLock.withLock(
        folder,
        setUpNotesFolder(folder).pipe(Effect.provide(services), withFiles, withPath),
      );
      const project = yield* projectService.create({
        commandId: CommandId.make(`majordome:restore-notes:${yield* random.uuidV4()}`),
        projectId: ProjectId.make(yield* random.uuidV4()),
        title: path.basename(folder),
        workspaceRoot: folder,
      });
      return { projectId: project.id, folder, file };
    },
    Effect.mapError((cause) =>
      isVaultError(cause)
        ? cause
        : new MajordomeVaultError({
            message: isFolderBackupError(cause)
              ? cause.message
              : "Your notes were brought back, but Majordome could not open the folder.",
            cause,
          }),
    ),
  );

  return MajordomeVaultService.of({
    listHistory,
    undo,
    changes,
    setRoutineLimits,
    startNotes,
    restoreNotes,
  });
});

export const layer = Layer.effect(MajordomeVaultService, make);
