/**
 * "Back up my brain": every 5 minutes, per vault, save the owner's edits, sync with the remote, and
 * nightly write an encrypted copy to the chosen folder. Every git write takes the shared vault lock.
 * Settings stay in this server's state dir; secrets in the Keychain or secret store, never the vault.
 */

// @effect-diagnostics-next-line nodeBuiltinImport:off -- A synchronous digest names the Keychain item.
import * as NodeCrypto from "node:crypto";

import {
  type MajordomeBackupChange,
  type MajordomeBackupInput,
  MajordomeBackupPause,
  type MajordomeBackupStatus,
  type MajordomeConfigureBackupInput,
  type MajordomeGitHubConnectPrompt,
  MajordomeVaultError,
  majordomeVaultSlug,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import { forkParked } from "../serverActivation.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as BackupPassphraseStore from "./BackupPassphraseStore.ts";
import {
  createBackupRepo,
  DEFAULT_GITHUB_CLIENT_ID,
  GITHUB_CLIENT_ID_VARIABLE,
  githubCredentialEnv,
  pollDeviceToken,
  requestDeviceCode,
} from "./githubBackup.ts";
import * as VaultActiveRuns from "./VaultActiveRuns.ts";
import { autosaveVault, listLines } from "./vaultAutosave.ts";
import { VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";
import { localIsoDate } from "./vaultContext.ts";
import {
  createVaultBundle,
  FOLDER_BACKUP_KEEP,
  storeFolderBackup,
  validateBackupFolder,
} from "./vaultFolderBackup.ts";
import * as VaultLock from "./VaultLock.ts";
import { findGitleaks } from "./vaultSecretScan.ts";
import {
  countUnsent,
  remoteHost,
  remoteWebUrl,
  resolveVaultRemote,
  syncVault,
} from "./vaultSync.ts";

const SAVE_INTERVAL = "5 minutes";
const GITHUB_TOKEN_SECRET = "majordome-github-token";
// Nightly: the first save cycle of a new day from this hour on.
const NIGHTLY_FROM_HOUR = 2;
const MIN_PASSPHRASE_LENGTH = 8;

const VaultBackupState = Schema.Struct({
  syncing: Schema.optional(Schema.Boolean),
  /** The remote Majordome added when it connected GitHub. */
  remoteName: Schema.optional(Schema.String),
  folder: Schema.optional(Schema.Struct({ path: Schema.String, keep: Schema.Number })),
  lastSavedAt: Schema.optional(Schema.String),
  saveError: Schema.optional(Schema.String),
  savePause: Schema.optional(MajordomeBackupPause),
  lastSyncedAt: Schema.optional(Schema.String),
  syncError: Schema.optional(Schema.String),
  syncPause: Schema.optional(MajordomeBackupPause),
  lastFolderBackupAt: Schema.optional(Schema.String),
  lastFolderFile: Schema.optional(Schema.String),
  folderError: Schema.optional(Schema.String),
});
type VaultBackupState = typeof VaultBackupState.Type;
type Mutable<T> = { -readonly [K in keyof T]?: T[K] | undefined };

const BackupLedger = Schema.Struct({ vaults: Schema.Record(Schema.String, VaultBackupState) });
type BackupLedger = typeof BackupLedger.Type;
const BackupLedgerJson = Schema.fromJsonString(BackupLedger);
const decodeLedger = Schema.decodeUnknownOption(BackupLedgerJson);
const encodeLedger = Schema.encodeSync(BackupLedgerJson);

/** The passphrase's name in the Keychain: the vault's folder, hashed. */
export const passphraseKey = (vaultRoot: string) =>
  NodeCrypto.createHash("sha256").update(vaultRoot).digest("hex").slice(0, 24);

const isoTime = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const localHour = (millis: number) =>
  DateTime.toParts(DateTime.makeZonedUnsafe(millis, { timeZone: DateTime.zoneMakeLocal() })).hour;

/** Due once per day, from the small hours on, so a laptop asleep at night backs up when it wakes. */
export function folderBackupDue(lastBackupAt: string | undefined, now: number): boolean {
  if (lastBackupAt === undefined) return true;
  const last = Date.parse(lastBackupAt);
  if (Number.isNaN(last)) return true;
  return localIsoDate(last) !== localIsoDate(now) && localHour(now) >= NIGHTLY_FROM_HOUR;
}

export class MajordomeBackup extends Context.Service<
  MajordomeBackup,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly getStatus: (
      input: MajordomeBackupInput,
    ) => Effect.Effect<MajordomeBackupStatus, MajordomeVaultError>;
    readonly backUpNow: (
      input: MajordomeBackupInput,
    ) => Effect.Effect<MajordomeBackupStatus, MajordomeVaultError>;
    readonly configure: (
      input: MajordomeConfigureBackupInput,
    ) => Effect.Effect<MajordomeBackupStatus, MajordomeVaultError>;
    readonly connectGitHubStart: (
      input: MajordomeBackupInput,
    ) => Effect.Effect<MajordomeGitHubConnectPrompt, MajordomeVaultError>;
    readonly connectGitHubWait: (
      input: MajordomeBackupInput,
    ) => Effect.Effect<MajordomeBackupStatus, MajordomeVaultError>;
    readonly connectGitHubCancel: (input: MajordomeBackupInput) => Effect.Effect<void>;
    /** One save, sync and (when due or forced) folder backup of one vault. */
    readonly runCycle: (
      vaultRoot: string,
      options?: { readonly forceFolderBackup?: boolean },
    ) => Effect.Effect<void>;
  }
>()("t3/majordome/MajordomeBackup") {}

interface PendingConnect {
  readonly deferred: Deferred.Deferred<MajordomeBackupStatus, MajordomeVaultError>;
  readonly fiber: Fiber.Fiber<unknown, unknown>;
}

const vaultError = (message: string, cause?: unknown) =>
  new MajordomeVaultError({ message, ...(cause === undefined ? {} : { cause }) });

const errorMessage = (cause: unknown, fallback: string) =>
  typeof cause === "object" &&
  cause !== null &&
  "message" in cause &&
  typeof cause.message === "string"
    ? cause.message
    : fallback;

export const make = Effect.fn("MajordomeBackup.make")(function* (options?: {
  /** Only tests lower it, to keep encryption fast. */
  readonly scryptWorkFactor?: number;
}) {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const passphrases = yield* BackupPassphraseStore.BackupPassphraseStore;
  const vaultLock = yield* VaultLock.VaultLock;
  const activeRuns = yield* VaultActiveRuns.VaultActiveRuns;
  const services = yield* Effect.context<
    | FileSystem.FileSystem
    | Path.Path
    | GitVcsDriver.GitVcsDriver
    | ProcessRunner.ProcessRunner
    | HttpClient.HttpClient
  >();
  const git = yield* GitVcsDriver.GitVcsDriver;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  const clientId =
    (yield* HostProcess.Environment)[GITHUB_CLIENT_ID_VARIABLE]?.trim() || DEFAULT_GITHUB_CLIENT_ID;
  const layerScope = yield* Effect.scope;
  const ledgerPath = path.join(config.stateDir, "majordome", "backup.json");
  const cycleLock = yield* Semaphore.make(1);
  const ledgerLock = yield* Semaphore.make(1);
  const pending = yield* Ref.make<ReadonlyMap<string, PendingConnect>>(new Map());

  const initial = Option.getOrElse(
    decodeLedger(yield* fileSystem.readFileString(ledgerPath).pipe(Effect.orElseSucceed(() => ""))),
    (): BackupLedger => ({ vaults: {} }),
  );
  const ledger = yield* Ref.make<BackupLedger>(initial);

  const nowIso = Effect.map(Clock.currentTimeMillis, isoTime);

  const readState = (vaultRoot: string) =>
    Effect.map(Ref.get(ledger), (current): VaultBackupState => current.vaults[vaultRoot] ?? {});

  /** Merges `patch` into the vault's state; an `undefined` value removes that field. */
  const updateState = (vaultRoot: string, patch: Mutable<VaultBackupState>) =>
    ledgerLock.withPermits(1)(
      Effect.gen(function* () {
        const next = yield* Ref.updateAndGet(ledger, (current) => {
          const merged: Record<string, unknown> = { ...current.vaults[vaultRoot], ...patch };
          for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
          return { vaults: { ...current.vaults, [vaultRoot]: merged as VaultBackupState } };
        });
        const temp = `${ledgerPath}.tmp`;
        yield* fileSystem.makeDirectory(path.dirname(ledgerPath), { recursive: true });
        yield* fileSystem.writeFileString(temp, encodeLedger(next));
        yield* fileSystem.rename(temp, ledgerPath);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome could not record its backup progress.", { cause }),
        ),
      ),
    );

  const pause = Effect.fn("MajordomeBackup.pause")(function* (
    previous: MajordomeBackupPause | undefined,
    reason: MajordomeBackupPause["reason"],
    files: ReadonlyArray<string>,
  ) {
    return {
      reason,
      files: [...files],
      since: previous?.reason === reason ? previous.since : yield* nowIso,
    };
  });

  const githubToken = secrets.get(GITHUB_TOKEN_SECRET).pipe(
    Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
    Effect.orElseSucceed(() => Option.none<string>()),
  );

  const isVaultFolder = (root: string) =>
    fileSystem
      .exists(path.join(root, VAULT_CONFIG_DIRNAME))
      .pipe(Effect.orElseSucceed(() => false));

  const vaultRootOf = Effect.fn("MajordomeBackup.vaultRootOf")(function* (
    projectId: MajordomeBackupInput["projectId"],
  ) {
    const project = Option.getOrUndefined(
      yield* projects.get(projectId).pipe(Effect.orElseSucceed(() => Option.none())),
    );
    if (project === undefined) return undefined;
    return (yield* isVaultFolder(project.workspaceRoot)) ? project.workspaceRoot : undefined;
  });

  const requireVault = (projectId: MajordomeBackupInput["projectId"]) =>
    vaultRootOf(projectId).pipe(
      Effect.filterOrFail(
        (root): root is string => root !== undefined,
        () => vaultError("That project is not a vault."),
      ),
    );

  const save = Effect.fn("MajordomeBackup.save")(function* (
    vaultRoot: string,
    gitleaks: string | null,
  ) {
    if (yield* activeRuns.isBusy(vaultRoot)) return;
    const state = yield* readState(vaultRoot);
    const result = yield* vaultLock
      .withLock(
        vaultRoot,
        autosaveVault({ cwd: vaultRoot, gitleaks }).pipe(Effect.provide(services)),
      )
      .pipe(Effect.result);
    if (result._tag === "Failure") {
      yield* Effect.logWarning("Majordome could not save the owner's edits.", {
        vaultRoot,
        cause: result.failure,
      });
      return yield* updateState(vaultRoot, { saveError: "Your latest edits could not be saved." });
    }
    const outcome = result.success;
    switch (outcome.status) {
      case "saved":
        return yield* updateState(vaultRoot, {
          lastSavedAt: yield* nowIso,
          saveError: undefined,
          savePause: undefined,
        });
      case "nothing":
        return yield* updateState(vaultRoot, { saveError: undefined, savePause: undefined });
      case "secret":
        return yield* updateState(vaultRoot, {
          savePause: yield* pause(state.savePause, "secret", outcome.files),
          saveError: undefined,
        });
      case "unfinished-merge":
        return yield* updateState(vaultRoot, {
          savePause: yield* pause(state.savePause, "unfinished-merge", []),
        });
      case "scan-failed":
        return yield* updateState(vaultRoot, {
          saveError: "The secret scan did not finish, so your edits were not saved this time.",
        });
    }
  });

  const sync = Effect.fn("MajordomeBackup.sync")(function* (
    vaultRoot: string,
    gitleaks: string | null,
  ) {
    const state = yield* readState(vaultRoot);
    if (state.syncing === false) return;
    const remote = yield* resolveVaultRemote({
      cwd: vaultRoot,
      preferred: state.remoteName ?? null,
    }).pipe(
      Effect.provide(services),
      Effect.orElseSucceed(() => null),
    );
    if (remote === null) return;
    const token = yield* githubToken;
    const credentialEnv =
      Option.isSome(token) && remote.url.startsWith("https://github.com/")
        ? githubCredentialEnv(token.value)
        : undefined;
    const result = yield* vaultLock
      .withLock(
        vaultRoot,
        syncVault({
          cwd: vaultRoot,
          remote,
          gitleaks,
          ...(credentialEnv === undefined ? {} : { credentialEnv }),
        }).pipe(Effect.provide(services)),
      )
      .pipe(Effect.result);
    if (result._tag === "Failure") {
      yield* Effect.logWarning("Majordome could not sync a vault.", {
        vaultRoot,
        cause: result.failure,
      });
      return yield* updateState(vaultRoot, { syncError: "Syncing stopped with an error." });
    }
    const outcome = result.success;
    switch (outcome.status) {
      case "synced":
        return yield* updateState(vaultRoot, {
          lastSyncedAt: yield* nowIso,
          syncError: undefined,
          syncPause: undefined,
        });
      case "skipped":
        return;
      case "conflict":
        return yield* updateState(vaultRoot, {
          syncPause: yield* pause(state.syncPause, "conflict", outcome.files),
        });
      case "secret":
        return yield* updateState(vaultRoot, {
          syncPause: yield* pause(state.syncPause, "secret-not-sent", outcome.files),
        });
      case "failed":
        return yield* updateState(vaultRoot, { syncError: outcome.message });
    }
  });

  const folderBackup = Effect.fn("MajordomeBackup.folderBackup")(function* (
    vaultRoot: string,
    force: boolean,
  ) {
    const state = yield* readState(vaultRoot);
    if (state.folder === undefined) return;
    const now = yield* Clock.currentTimeMillis;
    if (!force && !folderBackupDue(state.lastFolderBackupAt, now)) return;
    const folder = state.folder;
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const passphrase = yield* passphrases.get(passphraseKey(vaultRoot));
        if (Option.isNone(passphrase)) {
          return yield* vaultError(
            "The backup passphrase is missing on this computer. Choose the folder again.",
          );
        }
        const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-bundle-" });
        const bundlePath = path.join(temp, "vault.bundle");
        yield* vaultLock.withLock(
          vaultRoot,
          createVaultBundle({ cwd: vaultRoot, bundlePath }).pipe(Effect.provide(services)),
        );
        return yield* storeFolderBackup({
          bundlePath,
          folder: folder.path,
          slug: majordomeVaultSlug(path.basename(vaultRoot)),
          date: localIsoDate(now),
          passphrase: passphrase.value,
          keep: folder.keep,
          ...(options?.scryptWorkFactor === undefined
            ? {}
            : { scryptWorkFactor: options.scryptWorkFactor }),
        }).pipe(Effect.provide(services));
      }),
    ).pipe(Effect.result);
    if (result._tag === "Failure") {
      yield* Effect.logWarning("Majordome could not back up a vault to its folder.", {
        vaultRoot,
        cause: result.failure,
      });
      return yield* updateState(vaultRoot, {
        folderError: errorMessage(result.failure, "The backup to the folder failed."),
      });
    }
    yield* updateState(vaultRoot, {
      lastFolderBackupAt: isoTime(now),
      lastFolderFile: path.basename(result.success.file),
      folderError: undefined,
    });
  });

  const runCycle: MajordomeBackup["Service"]["runCycle"] = (vaultRoot, cycleOptions) =>
    cycleLock
      .withPermits(1)(
        Effect.gen(function* () {
          const gitleaks = yield* findGitleaks().pipe(
            Effect.provide(services),
            Effect.orElseSucceed(() => null),
          );
          yield* save(vaultRoot, gitleaks);
          yield* sync(vaultRoot, gitleaks);
          yield* folderBackup(vaultRoot, cycleOptions?.forceFolderBackup === true);
        }),
      )
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Majordome's backup of a vault stopped with an error.", {
            vaultRoot,
            cause,
          }),
        ),
        Effect.withSpan("MajordomeBackup.runCycle"),
      );

  const runAll = Effect.gen(function* () {
    for (const project of yield* projects.list()) {
      if (yield* isVaultFolder(project.workspaceRoot)) yield* runCycle(project.workspaceRoot);
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Majordome could not list vaults to back up.", { cause }),
    ),
  );

  const start: MajordomeBackup["Service"]["start"] = Effect.fn("MajordomeBackup.start")(
    function* () {
      yield* activeRuns.start();
      yield* forkParked(runAll.pipe(Effect.repeat(Schedule.spaced(SAVE_INTERVAL))));
    },
  );

  const statusOf = Effect.fn("MajordomeBackup.statusOf")(function* (vaultRoot: string) {
    const state = yield* readState(vaultRoot);
    const remote = yield* resolveVaultRemote({
      cwd: vaultRoot,
      preferred: state.remoteName ?? null,
    }).pipe(
      Effect.provide(services),
      Effect.orElseSucceed(() => null),
    );
    const unsent =
      remote === null
        ? null
        : yield* countUnsent({ cwd: vaultRoot, remote }).pipe(
            Effect.provide(services),
            Effect.orElseSucceed(() => null),
          );
    const host = remote === null ? null : remoteHost(remote.url);
    const syncing = state.syncing !== false;
    return {
      isVault: true,
      lastSavedAt: state.lastSavedAt ?? null,
      saveError: state.saveError ?? null,
      paused: state.savePause ?? (syncing ? (state.syncPause ?? null) : null),
      remote:
        remote === null
          ? null
          : {
              name: remote.name,
              host,
              isGitHub: host === "github.com",
              webUrl: remoteWebUrl(remote.url),
              syncing,
              backedUp:
                syncing &&
                unsent === 0 &&
                state.syncPause === undefined &&
                state.syncError === undefined,
              lastSyncedAt: state.lastSyncedAt ?? null,
              lastError: syncing ? (state.syncError ?? null) : null,
            },
      folder:
        state.folder === undefined
          ? null
          : {
              path: state.folder.path,
              keep: state.folder.keep,
              lastBackupAt: state.lastFolderBackupAt ?? null,
              lastFile: state.lastFolderFile ?? null,
              lastError: state.folderError ?? null,
            },
      github: { available: clientId !== "", signedIn: Option.isSome(yield* githubToken) },
      secretScan:
        (yield* findGitleaks().pipe(
          Effect.provide(services),
          Effect.orElseSucceed(() => null),
        )) !== null,
    } satisfies MajordomeBackupStatus;
  });

  const notAVault: MajordomeBackupStatus = {
    isVault: false,
    lastSavedAt: null,
    saveError: null,
    paused: null,
    remote: null,
    folder: null,
    github: { available: clientId !== "", signedIn: false },
    secretScan: false,
  };

  const getStatus: MajordomeBackup["Service"]["getStatus"] = Effect.fn("MajordomeBackup.getStatus")(
    function* (input) {
      const vaultRoot = yield* vaultRootOf(input.projectId);
      return vaultRoot === undefined ? notAVault : yield* statusOf(vaultRoot);
    },
  );

  const backUpNow: MajordomeBackup["Service"]["backUpNow"] = Effect.fn("MajordomeBackup.backUpNow")(
    function* (input) {
      const vaultRoot = yield* requireVault(input.projectId);
      yield* runCycle(vaultRoot, { forceFolderBackup: true });
      return yield* statusOf(vaultRoot);
    },
  );

  const applyChange = Effect.fn("MajordomeBackup.applyChange")(function* (
    vaultRoot: string,
    change: MajordomeBackupChange,
  ) {
    switch (change.type) {
      case "set-folder": {
        if (change.passphrase.length < MIN_PASSPHRASE_LENGTH) {
          return yield* vaultError(
            `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters; a few unrelated words work well.`,
          );
        }
        const folder = yield* validateBackupFolder({
          folder: change.path,
          vaultRoot,
          homeDirectory,
        }).pipe(
          Effect.provide(services),
          Effect.mapError((cause) => vaultError(cause.message, cause)),
        );
        yield* passphrases
          .set(passphraseKey(vaultRoot), change.passphrase)
          .pipe(Effect.mapError((cause) => vaultError(cause.message, cause)));
        yield* updateState(vaultRoot, {
          folder: { path: folder, keep: FOLDER_BACKUP_KEEP },
          lastFolderBackupAt: undefined,
          lastFolderFile: undefined,
          folderError: undefined,
        });
        // The first copy right away, so the person sees it work.
        return yield* runCycle(vaultRoot, { forceFolderBackup: true });
      }
      case "remove-folder":
        yield* passphrases.remove(passphraseKey(vaultRoot)).pipe(Effect.ignore);
        return yield* updateState(vaultRoot, {
          folder: undefined,
          lastFolderBackupAt: undefined,
          lastFolderFile: undefined,
          folderError: undefined,
        });
      case "set-syncing":
        yield* updateState(vaultRoot, {
          syncing: change.enabled,
          syncPause: undefined,
          syncError: undefined,
        });
        return change.enabled ? yield* runCycle(vaultRoot) : undefined;
      case "disconnect-github":
        return yield* secrets
          .remove(GITHUB_TOKEN_SECRET)
          .pipe(
            Effect.mapError((cause) => vaultError("Could not forget the GitHub sign-in.", cause)),
          );
    }
  });

  const configure: MajordomeBackup["Service"]["configure"] = Effect.fn("MajordomeBackup.configure")(
    function* (input) {
      const vaultRoot = yield* requireVault(input.projectId);
      yield* applyChange(vaultRoot, input.change);
      return yield* statusOf(vaultRoot);
    },
  );

  /** Creates the private repository, adds it as a remote and sends the vault there. */
  const connectWithToken = Effect.fn("MajordomeBackup.connectWithToken")(function* (
    vaultRoot: string,
    token: string,
  ) {
    const repo = yield* createBackupRepo(token).pipe(
      Effect.provide(services),
      Effect.mapError((cause) => vaultError(cause.message, cause)),
    );
    const remoteName = yield* vaultLock
      .withLock(
        vaultRoot,
        Effect.gen(function* () {
          const remotes = listLines(
            (yield* git.execute({
              operation: "majordome.githubRemote",
              cwd: vaultRoot,
              args: ["remote"],
            })).stdout,
          );
          const name = remotes.includes("origin") ? "majordome" : "origin";
          yield* git.execute({
            operation: "majordome.githubRemote",
            cwd: vaultRoot,
            args: remotes.includes(name)
              ? ["remote", "set-url", name, repo.cloneUrl]
              : ["remote", "add", name, repo.cloneUrl],
            writesSharedConfig: true,
          });
          return name;
        }),
      )
      .pipe(
        Effect.provide(services),
        Effect.mapError((cause) =>
          vaultError("Could not add the GitHub repository to your notes.", cause),
        ),
      );
    yield* updateState(vaultRoot, {
      remoteName,
      syncing: true,
      syncPause: undefined,
      syncError: undefined,
    });
    yield* runCycle(vaultRoot);
    return yield* statusOf(vaultRoot);
  });

  const connectGitHubStart: MajordomeBackup["Service"]["connectGitHubStart"] = Effect.fn(
    "MajordomeBackup.connectGitHubStart",
  )(function* (input) {
    const vaultRoot = yield* requireVault(input.projectId);
    if (clientId === "") {
      return yield* vaultError("Connecting GitHub is not set up on this server yet.");
    }
    const token = yield* githubToken;
    let prompt: MajordomeGitHubConnectPrompt;
    let work: Effect.Effect<MajordomeBackupStatus, MajordomeVaultError>;
    if (Option.isSome(token)) {
      prompt = { status: "signed-in" };
      work = connectWithToken(vaultRoot, token.value);
    } else {
      const code = yield* requestDeviceCode(clientId).pipe(
        Effect.provide(services),
        Effect.mapError((cause) => vaultError(cause.message, cause)),
      );
      prompt = {
        status: "code",
        userCode: code.userCode,
        verificationUri: code.verificationUri,
        expiresAt: code.expiresAt,
      };
      work = pollDeviceToken({ clientId, code }).pipe(
        Effect.provide(services),
        Effect.mapError((cause) => vaultError(cause.message, cause)),
        Effect.tap((accessToken) =>
          secrets
            .set(GITHUB_TOKEN_SECRET, new TextEncoder().encode(accessToken))
            .pipe(
              Effect.mapError((cause) => vaultError("Could not save the GitHub sign-in.", cause)),
            ),
        ),
        Effect.flatMap((accessToken) => connectWithToken(vaultRoot, accessToken)),
      );
    }
    const deferred = yield* Deferred.make<MajordomeBackupStatus, MajordomeVaultError>();
    const fiber = yield* work.pipe(
      Effect.provide(services),
      Deferred.into(deferred),
      Effect.forkIn(layerScope),
    );
    const previous = yield* Ref.modify(pending, (current) => [
      current.get(vaultRoot),
      new Map(current).set(vaultRoot, { deferred, fiber }),
    ]);
    if (previous !== undefined) {
      yield* Deferred.fail(
        previous.deferred,
        vaultError("A newer GitHub sign-in replaced this one."),
      );
      yield* Fiber.interrupt(previous.fiber);
    }
    return prompt;
  });

  const connectGitHubWait: MajordomeBackup["Service"]["connectGitHubWait"] = Effect.fn(
    "MajordomeBackup.connectGitHubWait",
  )(function* (input) {
    const vaultRoot = yield* requireVault(input.projectId);
    const current = (yield* Ref.get(pending)).get(vaultRoot);
    if (current === undefined)
      return yield* vaultError("No GitHub sign-in is in progress. Start again.");
    return yield* Deferred.await(current.deferred);
  });

  const connectGitHubCancel: MajordomeBackup["Service"]["connectGitHubCancel"] = Effect.fn(
    "MajordomeBackup.connectGitHubCancel",
  )(function* (input) {
    const vaultRoot = yield* vaultRootOf(input.projectId);
    if (vaultRoot === undefined) return;
    const current = (yield* Ref.get(pending)).get(vaultRoot);
    if (current === undefined) return;
    yield* Deferred.fail(current.deferred, vaultError("The GitHub sign-in was cancelled."));
    yield* Fiber.interrupt(current.fiber);
  });

  return MajordomeBackup.of({
    start,
    getStatus,
    backUpNow,
    configure,
    connectGitHubStart,
    connectGitHubWait,
    connectGitHubCancel,
    runCycle,
  });
});

export const layer = Layer.effect(MajordomeBackup, make()).pipe(
  Layer.provide(BackupPassphraseStore.layer),
  Layer.provide(VaultActiveRuns.layer),
  Layer.provide(ProcessRunner.layer),
);
