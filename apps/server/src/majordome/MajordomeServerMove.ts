/**
 * "Set up a server for me": rents a server at Hetzner, adds it to the owner's Tailscale network,
 * pairs with it and copies the notes, with no one logging in to it. Each step first looks for
 * what an earlier try made, and what is created is written down before the next call.
 */

import {
  type EnvironmentId,
  MAJORDOME_SERVER_MOVE_STEP_LABELS,
  MajordomeServerMoveError,
  MajordomeServerMovePhase,
  MajordomeServerMoveRemoval,
  MajordomeServerMoveStep,
  type MajordomeServerMoveCancelInput,
  type MajordomeServerMoveCheck,
  type MajordomeServerMoveCheckInput,
  type MajordomeServerMovePairingLink,
  type MajordomeServerMoveProblem,
  type MajordomeServerMoveRemoveInput,
  type MajordomeServerMoveSaveKeysInput,
  type MajordomeServerMoveStartInput,
  type MajordomeServerMoveStatus,
  type MajordomeServerMoveStepId,
  ProjectId,
} from "@t3tools/contracts";
import { readTailscaleStatus, type TailscaleStatus } from "@t3tools/tailscale";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { formatServerSetupSecret, serverSetupSecretExpiry } from "../auth/serverSetupSecret.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  createFirewall,
  createServer,
  deleteFirewall,
  deletePrimaryIp,
  deleteServer,
  getFirewall,
  getPricing,
  getServer,
  HetznerError,
  listFirewalls,
  listLocations,
  listServers,
  listServerTypes,
  probeWriteAccess,
  waitForAction,
} from "./hetznerApi.ts";
import { GITHUB_TOKEN_SECRET } from "./MajordomeBackup.ts";
import * as MajordomeRoutines from "./MajordomeRoutines.ts";
import {
  downloadVault,
  fetchEnvironment,
  issuePairingCredential,
  MoveRemoteError,
  readRoutines,
  redeemSetupSecret,
  runRoutinesThere,
  sendGitHubToken,
  sessionWorks,
  uploadVault,
} from "./moveRemote.ts";
import {
  cloudInitFor,
  defaultLocation,
  freeName,
  locationChoices,
  monthlyPriceOf,
  rankServerTypes,
  SERVER_BASE_NAME,
  SERVER_IMAGE,
  serverImageFor,
} from "./serverMovePlan.ts";
import {
  createAuthKey,
  deleteAuthKey,
  deleteDevice,
  exchangeOAuthToken,
  isTailscaleClientSecret,
  listDevices,
  MAJORDOME_TAG,
  TailscaleApiError,
} from "./tailscaleApi.ts";
import * as VaultActiveRuns from "./VaultActiveRuns.ts";
import { autosaveVault, identityEnv, ownerIdentity } from "./vaultAutosave.ts";
import { readVaultBrainId } from "./vaultBrainId.ts";
import { VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";
import { MAJORDOME_AUTHOR } from "./VaultCommitReactor.ts";
import { createVaultBundle } from "./vaultFolderBackup.ts";
import * as VaultLock from "./VaultLock.ts";
import { moveVaultRunner } from "./vaultRunner.ts";
import { findGitleaks } from "./vaultSecretScan.ts";
import { resolveVaultRemote } from "./vaultSync.ts";

const HETZNER_TOKEN_SECRET = "majordome-move-hetzner-token";
const TAILSCALE_SECRET = "majordome-move-tailscale-secret";
const AUTH_KEY_SECRET = "majordome-move-auth-key";
const SETUP_SECRET = "majordome-move-setup-secret";
const SESSION_SECRET = "majordome-move-session";

/** On every Hetzner resource made here; removal deletes only what carries this move's id. */
const MANAGED_LABEL = "managed-by";
const MANAGED_VALUE = "majordome";
const MOVE_LABEL = "majordome-move";

const STEP_ORDER: ReadonlyArray<MajordomeServerMoveStepId> = [
  "check",
  "key",
  "server",
  "start",
  "pair",
  "notes",
];

// One day is the shortest expiry Tailscale documents; the key is single-use and deleted after.
const AUTH_KEY_EXPIRY_SECONDS = 86_400;
const SETUP_SECRET_LIFETIME = Duration.hours(2);
const SETUP_SECRET_MARGIN = Duration.minutes(30);
const START_TIMEOUT = Duration.minutes(20);
const START_POLL_INTERVAL = Duration.seconds(10);
const TAILSCALE_TOKEN_LIFETIME = Duration.minutes(30);
const FIREWALL_DELETE_TRIES = 12;
const FIREWALL_DELETE_WAIT = Duration.seconds(5);
const SERVER_TYPE_TRIES = 3;
const SERVER_NAME_TRIES = 5;
const PAIRING_LINK_LIFETIME = Duration.minutes(5);
const SERVER_REF = "refs/majordome/server";
const TAILSCALE_DNS_SETTINGS = "https://login.tailscale.com/admin/dns";

const MoveRecord = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  vaultRoot: Schema.String,
  title: Schema.String,
  startedAt: Schema.String,
  location: Schema.String,
  phase: MajordomeServerMovePhase,
  /** The phase to return to when a removal is cut short. */
  phaseBeforeRemoval: Schema.optional(MajordomeServerMovePhase),
  steps: Schema.Array(MajordomeServerMoveStep),
  routinesOnServer: Schema.Boolean,
  /** The name chosen on the Tailscale network, and the network's own suffix. */
  hostname: Schema.optional(Schema.String),
  tailnetSuffix: Schema.optional(Schema.String),
  /** Devices that were on the network before, so the new one is told apart from them. */
  devicesBefore: Schema.optional(Schema.Array(Schema.String)),
  authKeyId: Schema.optional(Schema.String),
  firewallId: Schema.optional(Schema.Number),
  serverId: Schema.optional(Schema.Number),
  serverName: Schema.optional(Schema.String),
  serverType: Schema.optional(Schema.String),
  monthlyPrice: Schema.optional(Schema.String),
  currency: Schema.optional(Schema.String),
  primaryIpv4Id: Schema.optional(Schema.Number),
  deviceNodeId: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  environmentId: Schema.optional(Schema.String),
  serverLabel: Schema.optional(Schema.String),
});
type MoveRecord = typeof MoveRecord.Type;

const Ledger = Schema.Struct({
  move: Schema.NullOr(MoveRecord),
  removal: Schema.NullOr(MajordomeServerMoveRemoval),
});
type Ledger = typeof Ledger.Type;
const LedgerJson = Schema.fromJsonString(Ledger);
const decodeLedger = Schema.decodeUnknownOption(LedgerJson);
const encodeLedger = Schema.encodeSync(LedgerJson);

interface State {
  readonly ledger: Ledger;
  readonly keys: MajordomeServerMoveStatus["keys"];
}

/** A step's failure, already in the owner's words. */
class MoveStepError extends Schema.TaggedError<MoveStepError>()("MoveStepError", {
  message: Schema.String,
  canForce: Schema.optional(Schema.Boolean),
  cause: Schema.optional(Schema.Defect()),
}) {}

type StepFailure = HetznerError | TailscaleApiError | MoveRemoteError | MoveStepError;

type LocalTailscale = TailscaleStatus | "not-installed" | "unreadable";

const isServerMoveError = Schema.is(MajordomeServerMoveError);
const isPlainWordsError = Schema.is(
  Schema.Union([HetznerError, TailscaleApiError, MoveRemoteError, MoveStepError]),
);

/** The sentence to show for a failure; anything unforeseen gets `fallback`, never its own text. */
const problemOf = (error: unknown, fallback: string) =>
  isPlainWordsError(error) ? error.message : fallback;

const isMoveStepError = Schema.is(MoveStepError);

const isoTime = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

function toStatus(state: State): MajordomeServerMoveStatus {
  const move = state.ledger.move;
  return {
    keys: state.keys,
    removal: state.ledger.removal,
    move:
      move === null
        ? null
        : {
            id: move.id,
            projectId: move.projectId,
            startedAt: move.startedAt,
            phase: move.phase,
            steps: move.steps,
            routinesOnServer: move.routinesOnServer,
            server:
              move.serverName === undefined
                ? null
                : {
                    name: move.serverName,
                    location: move.location,
                    serverType: move.serverType ?? "",
                    monthlyPrice: move.monthlyPrice ?? null,
                    currency: move.currency ?? null,
                    url: move.url ?? null,
                    environmentId: (move.environmentId as EnvironmentId | undefined) ?? null,
                  },
          },
  };
}

/** What is wrong with a pasted value before any network call, or null. */
function tailscaleSecretProblem(value: string): string | null {
  if (isTailscaleClientSecret(value)) return null;
  if (value.startsWith("tskey-auth-")) {
    return "This is a Tailscale auth key. Majordome needs an OAuth credential's secret, which starts with tskey-client-.";
  }
  if (value.startsWith("tskey-api-")) {
    return "This is a Tailscale API access token. Majordome needs an OAuth credential's secret, which starts with tskey-client-.";
  }
  return "This does not look like a Tailscale OAuth secret. It starts with tskey-client-.";
}

function hetznerTokenProblem(value: string): string | null {
  if (value.startsWith("tskey-")) return "This is a Tailscale key, not a Hetzner one.";
  return /^[A-Za-z0-9]{32,}$/.test(value)
    ? null
    : "This does not look like a Hetzner API token: it is one long run of letters and digits.";
}

export class MajordomeServerMove extends Context.Service<
  MajordomeServerMove,
  {
    /** Picks up a move that was running when this server stopped. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly status: () => Effect.Effect<MajordomeServerMoveStatus>;
    /** The current status, then every change to it. */
    readonly changes: Stream.Stream<MajordomeServerMoveStatus>;
    readonly saveKeys: (
      input: MajordomeServerMoveSaveKeysInput,
    ) => Effect.Effect<MajordomeServerMoveStatus, MajordomeServerMoveError>;
    /** Forgets both keys. Removing a server made here needs them pasted again. */
    readonly forgetKeys: () => Effect.Effect<MajordomeServerMoveStatus, MajordomeServerMoveError>;
    /** Says precisely what would stop a move, and where a server can be ordered at what price. */
    readonly check: (
      input: MajordomeServerMoveCheckInput,
    ) => Effect.Effect<MajordomeServerMoveCheck, MajordomeServerMoveError>;
    readonly begin: (
      input: MajordomeServerMoveStartInput,
    ) => Effect.Effect<MajordomeServerMoveStatus, MajordomeServerMoveError>;
    /** Runs a failed move again from the step that failed. */
    readonly retry: () => Effect.Effect<MajordomeServerMoveStatus, MajordomeServerMoveError>;
    /** Stops a move that is not finished and removes what it made, unless told to keep it. */
    readonly cancel: (
      input: MajordomeServerMoveCancelInput,
    ) => Effect.Effect<MajordomeServerMoveStatus, MajordomeServerMoveError>;
    readonly issuePairingLink: () => Effect.Effect<
      MajordomeServerMovePairingLink,
      MajordomeServerMoveError
    >;
    /** Makes the new server run the routines, once a provider is signed in on it. */
    readonly moveRoutines: () => Effect.Effect<MajordomeServerMoveStatus, MajordomeServerMoveError>;
    /** Brings notes and routines back, then deletes the server, its firewall and its device. */
    readonly remove: (
      input: MajordomeServerMoveRemoveInput,
    ) => Effect.Effect<MajordomeServerMoveStatus, MajordomeServerMoveError>;
  }
>()("t3/majordome/MajordomeServerMove") {}

export const make = Effect.fn("MajordomeServerMove.make")(function* (options?: {
  /** Tests answer for the local Tailscale and the clock's zone. */
  readonly localTailscale?: Effect.Effect<LocalTailscale>;
  readonly timeZone?: string;
  readonly version?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const vaultLock = yield* VaultLock.VaultLock;
  const activeRuns = yield* VaultActiveRuns.VaultActiveRuns;
  const routines = yield* MajordomeRoutines.MajordomeRoutines;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const random = yield* SecureRandom.SecureRandom;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const services = yield* Effect.context<
    | FileSystem.FileSystem
    | Path.Path
    | GitVcsDriver.GitVcsDriver
    | ProcessRunner.ProcessRunner
    | HttpClient.HttpClient
  >();
  const spawner = yield* Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner);
  const layerScope = yield* Effect.scope;
  const version = options?.version ?? packageJson.version;
  const timeZone = options?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ledgerPath = path.join(config.stateDir, "majordome", "server-move.json");
  const operationLock = yield* Semaphore.make(1);
  const writeLock = yield* Semaphore.make(1);
  let runFiber: Fiber.Fiber<void> | undefined;

  const readSecret = (name: string) =>
    secrets.get(name).pipe(
      Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
      Effect.orElseSucceed(() => Option.none<string>()),
    );
  const writeSecret = (name: string, value: string) =>
    secrets.set(name, new TextEncoder().encode(value)).pipe(
      // The store's error names the secret, never its value.
      Effect.mapError(
        (cause) =>
          new MoveStepError({ message: "Majordome could not save a key on this computer.", cause }),
      ),
    );
  const dropSecret = (name: string) => secrets.remove(name).pipe(Effect.ignore);

  const readKeys = Effect.gen(function* () {
    return {
      hetzner: Option.isSome(yield* readSecret(HETZNER_TOKEN_SECRET)),
      tailscale: Option.isSome(yield* readSecret(TAILSCALE_SECRET)),
    };
  });

  const state = yield* SubscriptionRef.make<State>({
    ledger: Option.getOrElse(
      decodeLedger(
        yield* fileSystem.readFileString(ledgerPath).pipe(Effect.orElseSucceed(() => "")),
      ),
      (): Ledger => ({ move: null, removal: null }),
    ),
    keys: yield* readKeys,
  });

  const persist = Effect.fn("MajordomeServerMove.persist")(
    function* (ledger: Ledger) {
      const temp = `${ledgerPath}.tmp`;
      yield* fileSystem.makeDirectory(path.dirname(ledgerPath), { recursive: true });
      yield* fileSystem.writeFileString(temp, encodeLedger(ledger));
      yield* fileSystem.rename(temp, ledgerPath);
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Majordome could not record a server move's progress.", { cause }),
    ),
  );

  /** Changes the ledger, writes it to disk, then tells subscribers. */
  const updateLedger = (change: (ledger: Ledger) => Ledger) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const next = change((yield* SubscriptionRef.get(state)).ledger);
        yield* persist(next);
        yield* SubscriptionRef.update(state, (current) => ({ ...current, ledger: next }));
      }),
    );

  const patchMove = (patch: Partial<MoveRecord>) =>
    updateLedger((ledger) =>
      ledger.move === null ? ledger : { ...ledger, move: { ...ledger.move, ...patch } },
    );

  const setStep = (id: MajordomeServerMoveStepId, step: Omit<MajordomeServerMoveStep, "id">) =>
    updateLedger((ledger) =>
      ledger.move === null
        ? ledger
        : {
            ...ledger,
            move: {
              ...ledger.move,
              steps: ledger.move.steps.map((current) =>
                current.id === id ? { id, ...step } : current,
              ),
            },
          },
    );

  const currentMove = Effect.map(SubscriptionRef.get(state), (current) => current.ledger.move);
  const requireMove = currentMove.pipe(
    Effect.filterOrFail(
      (move): move is MoveRecord => move !== null,
      () => new MoveStepError({ message: "There is no server set up from here." }),
    ),
  );
  const statusNow = Effect.map(SubscriptionRef.get(state), toStatus);
  const refreshKeys = Effect.gen(function* () {
    const keys = yield* readKeys;
    yield* SubscriptionRef.update(state, (current) => ({ ...current, keys }));
  });

  const requireHetznerToken = readSecret(HETZNER_TOKEN_SECRET).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new MoveStepError({ message: "Paste your Hetzner key first." })),
        onSome: Effect.succeed,
      }),
    ),
  );
  const requireTailscaleSecret = readSecret(TAILSCALE_SECRET).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(new MoveStepError({ message: "Paste your Tailscale secret first." })),
        onSome: Effect.succeed,
      }),
    ),
  );
  const tailscaleToken = requireTailscaleSecret.pipe(Effect.flatMap(exchangeOAuthToken));

  const localTailscale: Effect.Effect<LocalTailscale> =
    options?.localTailscale ??
    (Option.isNone(spawner)
      ? Effect.succeed("unreadable" as const)
      : readTailscaleStatus.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner.value),
          Effect.map((status): LocalTailscale => status),
          Effect.catchTags({
            TailscaleCommandSpawnError: () => Effect.succeed("not-installed" as const),
          }),
          Effect.orElseSucceed(() => "unreadable" as const),
        ));

  const vaultOf = Effect.fn("MajordomeServerMove.vaultOf")(function* (projectId: ProjectId) {
    const project = Option.getOrUndefined(
      yield* projects.get(projectId).pipe(Effect.orElseSucceed(() => Option.none())),
    );
    if (project === undefined) return undefined;
    const isVault = yield* fileSystem
      .exists(path.join(project.workspaceRoot, VAULT_CONFIG_DIRNAME))
      .pipe(Effect.orElseSucceed(() => false));
    return isVault ? { root: project.workspaceRoot, title: project.title } : undefined;
  });

  const runGit = (cwd: string, args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    git.execute({
      operation: "majordome.serverMove",
      cwd,
      args,
      allowNonZeroExit,
      timeoutMs: 10 * 60_000,
      env: identityEnv(MAJORDOME_AUTHOR),
    });

  /** Saves the owner's edits so the copy is complete; a sentence when they can't be saved. */
  const saveNotes = Effect.fn("MajordomeServerMove.saveNotes")(function* (vaultRoot: string) {
    if (yield* activeRuns.isBusy(vaultRoot)) {
      return "A conversation is writing to your notes right now. Try again when it has finished.";
    }
    const gitleaks = yield* findGitleaks().pipe(Effect.provide(services));
    const saved = yield* vaultLock
      .withLock(
        vaultRoot,
        autosaveVault({ cwd: vaultRoot, gitleaks }).pipe(Effect.provide(services)),
      )
      .pipe(Effect.result);
    if (saved._tag === "Failure") return "Your latest edits could not be saved before the copy.";
    switch (saved.success.status) {
      case "secret":
        return `Something that looks like a password or key is in ${saved.success.files.slice(0, 3).join(", ")}. Remove it from your notes, then try again.`;
      case "unfinished-merge":
        return "Your notes are in the middle of combining two versions. Finish that in Back up my brain first.";
      case "scan-failed":
        return "The check for passwords in your notes did not finish, so they were not copied.";
    }
    const brainId = yield* readVaultBrainId(vaultRoot).pipe(
      Effect.provide(services),
      Effect.orElseSucceed(() => null),
    );
    return brainId === null ? "Your notes have no saved history yet." : null;
  });

  /** True, false, or null when GitHub's registry could not say. */
  const imagePublished = Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const repository = serverImageFor("").slice("ghcr.io/".length, -1);
    const token = yield* http
      .execute(
        HttpClientRequest.get("https://ghcr.io/token").pipe(
          HttpClientRequest.setUrlParams({ scope: `repository:${repository}:pull` }),
        ),
      )
      .pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ token: Schema.String }))),
      );
    const manifest = yield* http.execute(
      HttpClientRequest.get(`https://ghcr.io/v2/${repository}/manifests/${version}`).pipe(
        HttpClientRequest.bearerToken(token.token),
        HttpClientRequest.setHeader(
          "accept",
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
        ),
      ),
    );
    return manifest.status === 200 ? true : manifest.status === 404 ? false : null;
  }).pipe(
    Effect.timeout(Duration.seconds(15)),
    Effect.orElseSucceed(() => null),
    Effect.provide(services),
  );

  /** Everything that would stop a move. `probe` also makes and deletes a firewall and a key. */
  const diagnose = Effect.fn("MajordomeServerMove.diagnose")(function* (input: {
    readonly projectId: ProjectId;
    readonly probe: boolean;
  }) {
    const problems: Array<MajordomeServerMoveProblem> = [];
    const notices: Array<string> = [];
    const now = yield* Clock.currentTimeMillis;

    const vault = yield* vaultOf(input.projectId);
    if (vault === undefined) {
      problems.push({ area: "notes", message: "Choose a notes folder to move first." });
    } else {
      const notesProblem = yield* saveNotes(vault.root);
      if (notesProblem !== null) problems.push({ area: "notes", message: notesProblem });
      const remote = yield* resolveVaultRemote({ cwd: vault.root, preferred: null }).pipe(
        Effect.provide(services),
        Effect.orElseSucceed(() => null),
      );
      if (remote === null) {
        notices.push(
          "Your notes are not backed up to GitHub, so after the move this computer's copy stops following the server's. Connect GitHub in Back up my brain first to keep both in step.",
        );
      } else if (!remote.url.startsWith("https://")) {
        notices.push(
          "Your notes are backed up with a key that only this computer has, so the server will not send its changes to that backup. Connect GitHub in Back up my brain to keep both in step.",
        );
      }
    }

    const local = yield* localTailscale;
    let localName: string | null = null;
    if (local === "not-installed") {
      problems.push({
        area: "this-computer",
        message:
          "Tailscale is not installed on this computer. Set it up in Settings > Your phone first.",
      });
    } else if (local === "unreadable" || local.running === false || local.magicDnsName === null) {
      problems.push({
        area: "this-computer",
        message: "Tailscale is not signed in on this computer. Open Tailscale and sign in.",
      });
    } else {
      localName = local.magicDnsName;
      if (local.httpsServeEnabled === false) {
        problems.push({
          area: "tailscale",
          message: `HTTPS is off for your Tailscale network, so the server would have no secure address. Turn on HTTPS Certificates at ${TAILSCALE_DNS_SETTINGS}.`,
        });
      }
    }

    if ((yield* imagePublished) === false) {
      problems.push({
        area: "this-computer",
        message: `This version of Majordome (${version}) has no server version published. Update Majordome, then try again.`,
      });
    }

    let choices: MajordomeServerMoveCheck["locations"] = [];
    let currency: string | null = null;
    const hetznerToken = yield* readSecret(HETZNER_TOKEN_SECRET);
    if (Option.isNone(hetznerToken)) {
      problems.push({ area: "hetzner", message: "Paste your Hetzner key." });
    } else {
      const token = hetznerToken.value;
      const read = yield* Effect.all([listServerTypes(token), listLocations(token)]).pipe(
        Effect.provide(services),
        Effect.result,
      );
      if (read._tag === "Failure") {
        problems.push({ area: "hetzner", message: read.failure.message });
      } else {
        const pricing = yield* getPricing(token).pipe(
          Effect.provide(services),
          Effect.orElseSucceed(() => null),
        );
        currency = pricing?.currency ?? null;
        choices = locationChoices({
          types: read.success[0],
          locations: read.success[1],
          pricing,
          now,
        });
        if (choices.length === 0) {
          problems.push({
            area: "hetzner",
            message: "Hetzner has no suitable server to order right now. Try again later.",
          });
        }
        if (input.probe) {
          const probed = yield* probeWriteAccess(
            token,
            `majordome-check-${(yield* random.uuidV4()).slice(0, 8)}`,
          ).pipe(Effect.provide(services), Effect.result);
          if (probed._tag === "Failure") {
            problems.push({
              area: "hetzner",
              message: problemOf(probed.failure, "Hetzner could not confirm the key."),
            });
          }
        }
      }
    }

    const tailscaleSecret = yield* readSecret(TAILSCALE_SECRET);
    if (Option.isNone(tailscaleSecret)) {
      problems.push({ area: "tailscale", message: "Paste your Tailscale secret." });
    } else {
      const checked = yield* Effect.gen(function* () {
        const token = yield* exchangeOAuthToken(tailscaleSecret.value);
        const devices = yield* listDevices(token);
        if (
          localName !== null &&
          !devices.some((device) => device.name.toLowerCase() === localName.toLowerCase())
        ) {
          return "This Tailscale credential belongs to a different Tailscale network than the one this computer is on.";
        }
        if (input.probe) {
          const key = yield* createAuthKey(token, {
            description: "Majordome check",
            expirySeconds: AUTH_KEY_EXPIRY_SECONDS,
          });
          yield* deleteAuthKey(token, key.id);
        }
        return null;
      }).pipe(Effect.provide(services), Effect.result);
      const message = checked._tag === "Failure" ? checked.failure.message : checked.success;
      if (message !== null) problems.push({ area: "tailscale", message });
    }

    return {
      problems,
      notices,
      locations: choices,
      defaultLocation: defaultLocation(timeZone, choices),
      currency,
    } satisfies MajordomeServerMoveCheck;
  });

  const labelsFor = (move: MoveRecord) => ({
    [MANAGED_LABEL]: MANAGED_VALUE,
    [MOVE_LABEL]: move.id,
  });
  const moveSelector = (move: MoveRecord) => `${MOVE_LABEL}=${move.id}`;
  const isOurs = (labels: Readonly<Record<string, string>> | undefined, move: MoveRecord) =>
    labels?.[MOVE_LABEL] === move.id && labels[MANAGED_LABEL] === MANAGED_VALUE;

  const checkStep = Effect.fn("MajordomeServerMove.checkStep")(function* (move: MoveRecord) {
    const result = yield* diagnose({ projectId: move.projectId, probe: false });
    if (result.problems.length > 0) {
      return yield* new MoveStepError({
        message: result.problems.map((problem) => problem.message).join(" "),
      });
    }
    if (!result.locations.some((choice) => choice.name === move.location)) {
      return yield* new MoveStepError({
        message:
          "Hetzner has no suitable server in that location right now. Stop, then choose another location.",
      });
    }
  });

  const keyStep = Effect.fn("MajordomeServerMove.keyStep")(function* (move: MoveRecord) {
    if (move.authKeyId !== undefined && Option.isSome(yield* readSecret(AUTH_KEY_SECRET))) return;
    const local = yield* localTailscale;
    const localName = typeof local === "object" ? local.magicDnsName : null;
    if (localName === null || !localName.includes(".")) {
      return yield* new MoveStepError({
        message: "Tailscale is not signed in on this computer. Open Tailscale and sign in.",
      });
    }
    const token = yield* tailscaleToken;
    if (move.authKeyId !== undefined)
      yield* deleteAuthKey(token, move.authKeyId).pipe(Effect.ignore);
    const devices = yield* listDevices(token);
    const hostname = freeName(
      SERVER_BASE_NAME,
      new Set(devices.map((device) => device.name.split(".")[0]!.toLowerCase())),
    );
    const key = yield* createAuthKey(token, {
      description: `Majordome server ${move.id.slice(0, 8)}`,
      expirySeconds: AUTH_KEY_EXPIRY_SECONDS,
    });
    yield* writeSecret(AUTH_KEY_SECRET, key.key);
    yield* patchMove({
      authKeyId: key.id,
      hostname,
      tailnetSuffix: localName.slice(localName.indexOf(".") + 1),
      devicesBefore: devices.map((device) => device.nodeId),
    });
  });

  const ensureFirewall = Effect.fn("MajordomeServerMove.ensureFirewall")(function* (
    token: string,
    move: MoveRecord,
  ) {
    if (
      move.firewallId !== undefined &&
      Option.isSome(yield* getFirewall(token, move.firewallId))
    ) {
      return move.firewallId;
    }
    const existing = (yield* listFirewalls(token, moveSelector(move)))[0];
    const firewall =
      existing ??
      (yield* createFirewall(token, {
        name: `majordome-${move.id.slice(0, 8)}`,
        labels: labelsFor(move),
      }));
    yield* patchMove({ firewallId: firewall.id });
    return firewall.id;
  });

  /** The setup secret to put on a new server: the stored one while it has time left, else new. */
  const setupSecretFor = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const stored = Option.getOrUndefined(yield* readSecret(SETUP_SECRET));
    const expiry = stored === undefined ? undefined : serverSetupSecretExpiry(stored);
    if (
      stored !== undefined &&
      expiry !== undefined &&
      expiry.epochMilliseconds - now > Duration.toMillis(SETUP_SECRET_MARGIN)
    ) {
      return stored;
    }
    const secret = formatServerSetupSecret({
      expiresAt: DateTime.makeUnsafe(now + Duration.toMillis(SETUP_SECRET_LIFETIME)),
      random: yield* random
        .randomBytes(32)
        .pipe(
          Effect.mapError(
            (cause) =>
              new MoveStepError({ message: "Majordome could not make a setup code.", cause }),
          ),
        ),
    });
    yield* writeSecret(SETUP_SECRET, secret);
    return secret;
  });

  const serverStep = Effect.fn("MajordomeServerMove.serverStep")(function* (move: MoveRecord) {
    const token = yield* requireHetznerToken;
    const firewallId = yield* ensureFirewall(token, move);
    const known =
      move.serverId === undefined ? Option.none() : yield* getServer(token, move.serverId);
    // A server made just before a restart was not written down yet; its label finds it.
    const adopted = Option.isSome(known)
      ? known.value
      : (yield* listServers(token, moveSelector(move)))[0];
    if (adopted !== undefined) {
      yield* patchMove({
        serverId: adopted.id,
        serverName: adopted.name,
        serverType: adopted.server_type?.name ?? move.serverType,
        primaryIpv4Id: adopted.public_net?.ipv4?.id ?? move.primaryIpv4Id,
      });
      return;
    }
    const authKey = Option.getOrUndefined(yield* readSecret(AUTH_KEY_SECRET));
    if (authKey === undefined || move.hostname === undefined || move.tailnetSuffix === undefined) {
      return yield* new MoveStepError({
        message: "The Tailscale key for the new server is missing. Stop and start again.",
      });
    }
    const userData = cloudInitFor({
      version,
      authKey,
      setupSecret: yield* setupSecretFor,
      timeZone,
      hostname: move.hostname,
      publicUrl: `https://${move.hostname}.${move.tailnetSuffix}`,
    });
    if (userData === null) {
      return yield* new MoveStepError({
        message: "Majordome could not prepare the new server's setup.",
      });
    }
    const now = yield* Clock.currentTimeMillis;
    const types = rankServerTypes(yield* listServerTypes(token), move.location, now).slice(
      0,
      SERVER_TYPE_TRIES,
    );
    const pricing = yield* getPricing(token).pipe(Effect.orElseSucceed(() => null));
    let lastError: HetznerError = new HetznerError({ reason: "unavailable" });
    const taken = new Set<string>();
    for (const type of types) {
      for (let attempt = 0; attempt < SERVER_NAME_TRIES; attempt++) {
        const name = freeName(SERVER_BASE_NAME, taken);
        const created = yield* createServer(token, {
          name,
          serverType: type.name,
          location: move.location,
          image: SERVER_IMAGE,
          userData,
          labels: labelsFor(move),
          firewallId,
        }).pipe(Effect.result);
        if (created._tag === "Success") {
          yield* patchMove({
            serverId: created.success.server.id,
            serverName: created.success.server.name,
            serverType: type.name,
            primaryIpv4Id: created.success.server.public_net?.ipv4?.id,
            monthlyPrice: monthlyPriceOf(type, move.location, pricing) ?? undefined,
            currency: pricing?.currency,
          });
          yield* Effect.forEach(created.success.actions, (action) => waitForAction(token, action), {
            discard: true,
          });
          return;
        }
        lastError = created.failure;
        if (created.failure.reason === "name-taken") {
          taken.add(name);
          continue;
        }
        break;
      }
      if (lastError.reason !== "unavailable") break;
    }
    return yield* lastError;
  });

  const startStep = Effect.fn("MajordomeServerMove.startStep")(function* (move: MoveRecord) {
    const before = new Set(move.devicesBefore ?? []);
    const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(START_TIMEOUT);
    let token = yield* tailscaleToken;
    let tokenAt = yield* Clock.currentTimeMillis;
    let joinedAs: string | undefined = move.url === undefined ? undefined : new URL(move.url).host;
    while (true) {
      const now = yield* Clock.currentTimeMillis;
      if (now - tokenAt > Duration.toMillis(TAILSCALE_TOKEN_LIFETIME)) {
        token = yield* tailscaleToken;
        tokenAt = now;
      }
      // The network may add a number to the name, so the real one is read, never assumed.
      const device = (yield* listDevices(token).pipe(Effect.orElseSucceed(() => []))).find(
        (candidate) =>
          candidate.nodeId === move.deviceNodeId ||
          (!before.has(candidate.nodeId) && candidate.hostname === move.hostname),
      );
      if (device !== undefined) {
        joinedAs = device.name;
        const url = `https://${device.name}`;
        yield* patchMove({ deviceNodeId: device.nodeId, url });
        const answering = yield* fetchEnvironment(url);
        if (Option.isSome(answering)) {
          yield* patchMove({
            environmentId: answering.value.environmentId,
            serverLabel: answering.value.label,
          });
          return;
        }
      }
      // Read again: the calls above can take as long as their own timeouts.
      if ((yield* Clock.currentTimeMillis) >= deadline) break;
      yield* Effect.sleep(START_POLL_INTERVAL);
    }
    return yield* new MoveStepError({
      message:
        joinedAs === undefined
          ? "The server was created but did not join your Tailscale network in 20 minutes. Try again to keep waiting, or stop to remove it."
          : `The server joined your Tailscale network as ${joinedAs} but does not answer there yet. Check that HTTPS Certificates are on at ${TAILSCALE_DNS_SETTINGS}; if you changed Tailscale's access rules, they must let your devices reach ${MAJORDOME_TAG}. Then try again.`,
    });
  });

  const sessionFor = Effect.fn("MajordomeServerMove.sessionFor")(function* (move: MoveRecord) {
    const token = Option.getOrUndefined(yield* readSecret(SESSION_SECRET));
    if (move.url === undefined || token === undefined) {
      return yield* new MoveStepError({ message: "This computer is not connected to the server." });
    }
    return { url: move.url, token };
  });

  const pairStep = Effect.fn("MajordomeServerMove.pairStep")(function* (move: MoveRecord) {
    if (move.url === undefined) {
      return yield* new MoveStepError({ message: "The server has no address yet." });
    }
    const existing = Option.getOrUndefined(yield* readSecret(SESSION_SECRET));
    if (existing === undefined || !(yield* sessionWorks(move.url, existing))) {
      const secret = Option.getOrUndefined(yield* readSecret(SETUP_SECRET));
      if (secret === undefined) {
        return yield* new MoveStepError({
          message:
            "The server's one-time setup code is gone from this computer. Stop to remove the server, then start again.",
        });
      }
      const session = yield* redeemSetupSecret(move.url, {
        secret,
        label: `Majordome on ${(yield* environment.getDescriptor).label}`,
      }).pipe(
        Effect.mapError((error) =>
          error.reason === "signed-out"
            ? new MoveStepError({
                message:
                  "The server did not accept its one-time setup code: it had expired or was already used. Stop to remove the server, then start again.",
              })
            : error,
        ),
      );
      yield* writeSecret(SESSION_SECRET, session);
    }
    // Both one-time secrets are spent now; nothing here needs them again.
    yield* dropSecret(SETUP_SECRET);
    yield* dropSecret(AUTH_KEY_SECRET);
    if (move.authKeyId !== undefined) {
      yield* tailscaleToken.pipe(
        Effect.flatMap((token) => deleteAuthKey(token, move.authKeyId!)),
        Effect.ignore,
      );
    }
  });

  const notesStep = Effect.fn("MajordomeServerMove.notesStep")(function* (move: MoveRecord) {
    const session = yield* sessionFor(move);
    const notesProblem = yield* saveNotes(move.vaultRoot);
    if (notesProblem !== null) return yield* new MoveStepError({ message: notesProblem });
    const remote = yield* resolveVaultRemote({ cwd: move.vaultRoot, preferred: null }).pipe(
      Effect.orElseSucceed(() => null),
    );
    const identity = yield* ownerIdentity(move.vaultRoot);
    const sent = yield* Effect.scoped(
      Effect.gen(function* () {
        const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-move-" });
        const bundlePath = path.join(temp, "vault.bundle");
        // Bundle and HEAD under one lock, so the server is compared with exactly what was sent.
        const local = yield* vaultLock.withLock(
          move.vaultRoot,
          Effect.gen(function* () {
            yield* createVaultBundle({ cwd: move.vaultRoot, bundlePath });
            return {
              head: (yield* runGit(move.vaultRoot, ["rev-parse", "HEAD"])).stdout.trim(),
              brainId: yield* readVaultBrainId(move.vaultRoot),
            };
          }),
        );
        const received = yield* uploadVault(session.url, session.token, {
          bundlePath,
          title: move.title,
          identity,
          ...(remote === null ? {} : { remote: { name: remote.name, url: remote.url } }),
        });
        return { local, received };
      }),
    ).pipe(
      Effect.mapError((error) =>
        isPlainWordsError(error)
          ? error
          : new MoveStepError({
              message: "Your notes could not be packed for the copy.",
              cause: error,
            }),
      ),
    );
    if (sent.received.head !== sent.local.head || sent.received.brainId !== sent.local.brainId) {
      return yield* new MoveStepError({
        message:
          "The notes on the server are not the same as the ones on this computer. Try again.",
      });
    }
    const githubToken = yield* readSecret(GITHUB_TOKEN_SECRET);
    if (Option.isSome(githubToken) && remote?.url.startsWith("https://github.com/")) {
      yield* sendGitHubToken(session.url, session.token, githubToken.value);
    }
  });

  const stepFallback = (id: MajordomeServerMoveStepId) =>
    `Majordome could not finish "${MAJORDOME_SERVER_MOVE_STEP_LABELS[id]}". Try again.`;
  /** A step's own sentence when it has one; anything unforeseen is logged and gets the fallback. */
  const asStepFailure =
    (id: MajordomeServerMoveStepId) =>
    (error: unknown): StepFailure =>
      isPlainWordsError(error)
        ? error
        : new MoveStepError({ message: stepFallback(id), cause: error });
  const steps: Record<
    MajordomeServerMoveStepId,
    (move: MoveRecord) => Effect.Effect<void, StepFailure>
  > = {
    check: (move) => checkStep(move).pipe(Effect.mapError(asStepFailure("check"))),
    key: (move) =>
      keyStep(move).pipe(Effect.provide(services), Effect.mapError(asStepFailure("key"))),
    server: (move) =>
      serverStep(move).pipe(Effect.provide(services), Effect.mapError(asStepFailure("server"))),
    start: (move) =>
      startStep(move).pipe(Effect.provide(services), Effect.mapError(asStepFailure("start"))),
    pair: (move) =>
      pairStep(move).pipe(Effect.provide(services), Effect.mapError(asStepFailure("pair"))),
    notes: (move) =>
      notesStep(move).pipe(Effect.provide(services), Effect.mapError(asStepFailure("notes"))),
  };

  /** Runs every step that is not done, in order, and stops at the first that fails. */
  const run = Effect.gen(function* () {
    for (const id of STEP_ORDER) {
      const move = yield* currentMove;
      if (move === null || move.phase !== "running") return;
      if (move.steps.find((step) => step.id === id)?.state === "done") continue;
      yield* setStep(id, { state: "working" });
      const outcome = yield* steps[id](move).pipe(
        Effect.catchDefect((cause) =>
          Effect.fail(new MoveStepError({ message: stepFallback(id), cause })),
        ),
        Effect.result,
      );
      if (outcome._tag === "Failure") {
        if (outcome.failure.cause !== undefined) {
          yield* Effect.logWarning("A server move step failed unexpectedly.", {
            step: id,
            cause: outcome.failure.cause,
          });
        }
        yield* setStep(id, { state: "failed", problem: outcome.failure.message });
        yield* patchMove({ phase: "failed" });
        return;
      }
      yield* setStep(id, { state: "done" });
    }
    yield* patchMove({ phase: "ready" });
  });

  const forkRun = Effect.gen(function* () {
    runFiber = yield* run.pipe(Effect.forkIn(layerScope));
  });

  const stopRun = Effect.gen(function* () {
    if (runFiber !== undefined) yield* Fiber.interrupt(runFiber);
    runFiber = undefined;
  });

  /** The server's notes merged into this computer's; what happened, in the owner's words. */
  const bringNotesBack = Effect.fn("MajordomeServerMove.bringNotesBack")(function* (
    move: MoveRecord,
  ) {
    const session = yield* sessionFor(move);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-back-" });
        const bundlePath = path.join(temp, "server.bundle");
        yield* downloadVault(session.url, session.token, bundlePath);
        const gitleaks = yield* findGitleaks();
        return yield* vaultLock.withLock(
          move.vaultRoot,
          Effect.gen(function* () {
            yield* autosaveVault({ cwd: move.vaultRoot, gitleaks }).pipe(Effect.ignore);
            yield* runGit(move.vaultRoot, ["fetch", "--quiet", bundlePath, `+HEAD:${SERVER_REF}`]);
            const nothingNew = yield* runGit(
              move.vaultRoot,
              ["merge-base", "--is-ancestor", SERVER_REF, "HEAD"],
              true,
            );
            if (nothingNew.exitCode === 0) return "Your notes here were already up to date.";
            const merged = yield* runGit(
              move.vaultRoot,
              ["-c", "commit.gpgsign=false", "merge", "--quiet", "--no-edit", SERVER_REF],
              true,
            );
            if (merged.exitCode === 0)
              return "Copied the notes changed on the server back to this computer.";
            yield* runGit(move.vaultRoot, ["merge", "--abort"], true);
            return yield* new MoveStepError({
              message:
                "Your notes changed both here and on the server in ways Majordome cannot combine by itself.",
            });
          }),
        );
      }),
    );
  });

  /** Deletes this move's server and firewall at Hetzner, and nothing that lacks its label. */
  const removeFromHetzner = Effect.fn("MajordomeServerMove.removeFromHetzner")(function* (
    move: MoveRecord,
    did: Array<string>,
  ) {
    // Before the server step ran, nothing can exist at Hetzner, written down or not.
    const neverReached = move.steps.find((step) => step.id === "server")?.state === "pending";
    if (neverReached && move.serverId === undefined && move.firewallId === undefined) return;
    const token = Option.getOrUndefined(yield* readSecret(HETZNER_TOKEN_SECRET));
    if (token === undefined) {
      return yield* new MoveStepError({
        message: "Paste your Hetzner key again so Majordome can remove the server.",
      });
    }
    const recorded =
      move.serverId === undefined ? Option.none() : yield* getServer(token, move.serverId);
    if (Option.isSome(recorded) && !isOurs(recorded.value.labels, move)) {
      return yield* new MoveStepError({
        message: `The server ${recorded.value.name} at Hetzner was not made by this setup, so Majordome left it alone. Remove it in Hetzner's console if it is yours.`,
      });
    }
    const servers = [
      ...(Option.isSome(recorded) ? [recorded.value] : []),
      ...(yield* listServers(token, moveSelector(move))).filter(
        (server) => server.id !== move.serverId,
      ),
    ];
    for (const server of servers) {
      const action = yield* deleteServer(token, server.id);
      if (Option.isSome(action)) yield* waitForAction(token, action.value);
      did.push(`Deleted the server ${server.name} at Hetzner.`);
      const address = server.public_net?.ipv4?.id ?? move.primaryIpv4Id;
      // Hetzner deletes the address with the server; this is for when it did not.
      if (address !== undefined) yield* deletePrimaryIp(token, address).pipe(Effect.ignore);
    }
    const recordedFirewall =
      move.firewallId === undefined ? Option.none() : yield* getFirewall(token, move.firewallId);
    const firewalls = [
      ...(Option.isSome(recordedFirewall) && isOurs(recordedFirewall.value.labels, move)
        ? [recordedFirewall.value]
        : []),
      ...(yield* listFirewalls(token, moveSelector(move))).filter(
        (firewall) => firewall.id !== move.firewallId,
      ),
    ];
    for (const firewall of firewalls) {
      // Hetzner lets go of a deleted server's firewall a moment after the server.
      for (let attempt = 1; ; attempt++) {
        const deleted = yield* deleteFirewall(token, firewall.id).pipe(Effect.result);
        if (deleted._tag === "Success") break;
        if (deleted.failure.reason !== "in-use" || attempt >= FIREWALL_DELETE_TRIES) {
          return yield* deleted.failure;
        }
        yield* Effect.sleep(FIREWALL_DELETE_WAIT);
      }
      did.push("Deleted its firewall at Hetzner.");
    }
  });

  const removeFromTailscale = Effect.fn("MajordomeServerMove.removeFromTailscale")(function* (
    move: MoveRecord,
    did: Array<string>,
  ) {
    if (move.authKeyId === undefined && move.deviceNodeId === undefined) return;
    const token = yield* tailscaleToken;
    if (move.authKeyId !== undefined) yield* deleteAuthKey(token, move.authKeyId);
    const before = new Set(move.devicesBefore ?? []);
    const device = (yield* listDevices(token)).find(
      (candidate) =>
        candidate.nodeId === move.deviceNodeId ||
        (move.deviceNodeId === undefined &&
          !before.has(candidate.nodeId) &&
          candidate.hostname === move.hostname &&
          candidate.tags?.includes(MAJORDOME_TAG) === true),
    );
    if (device !== undefined) {
      yield* deleteDevice(token, device.nodeId);
      did.push(`Removed ${device.name.split(".")[0]} from your Tailscale network.`);
    }
  });

  /** Takes everything down. Only a ready server has notes and routines to bring back first. */
  const takeDown = Effect.fn("MajordomeServerMove.takeDown")(function* (force: boolean) {
    const move = yield* requireMove;
    const previous = move.phase === "removing" ? (move.phaseBeforeRemoval ?? "failed") : move.phase;
    yield* patchMove({ phase: "removing", phaseBeforeRemoval: previous });
    const did: Array<string> = [];
    const problems: Array<string> = [];
    const removal = Effect.gen(function* () {
      if (previous === "ready") {
        const back = yield* bringNotesBack(move).pipe(Effect.result);
        if (back._tag === "Success") {
          did.push(back.success);
        } else if (!force) {
          return yield* new MoveStepError({
            message: `${problemOf(back.failure, "The notes on the server could not be copied back.")} Notes changed on the server since the move would be lost.`,
            canForce: true,
          });
        } else {
          problems.push("Notes changed on the server were not copied back to this computer.");
        }
        if (move.routinesOnServer) {
          yield* routines.runHere(move.projectId).pipe(
            Effect.mapError(
              (cause) =>
                new MoveStepError({
                  message: "Routines could not be moved back to this computer.",
                  cause,
                }),
            ),
          );
          yield* patchMove({ routinesOnServer: false });
          did.push("Routines run on this computer again.");
        }
      }
      yield* removeFromHetzner(move, did);
      const tailscale = yield* removeFromTailscale(move, did).pipe(Effect.result);
      if (tailscale._tag === "Failure") {
        problems.push(
          `The server could not be removed from Tailscale (${problemOf(tailscale.failure, "unexpected error")}). Remove ${move.hostname ?? SERVER_BASE_NAME} on Tailscale's Machines page.`,
        );
      }
      yield* Effect.forEach([AUTH_KEY_SECRET, SETUP_SECRET, SESSION_SECRET], dropSecret, {
        discard: true,
      });
      const at = isoTime(yield* Clock.currentTimeMillis);
      yield* updateLedger(() => ({ move: null, removal: { at, did, problems } }));
    }).pipe(Effect.provide(services));
    return yield* removal.pipe(
      Effect.tapError(() => patchMove({ phase: previous, phaseBeforeRemoval: undefined })),
    );
  });

  const toRpcError = (fallback: string) => (cause: unknown) =>
    isServerMoveError(cause)
      ? cause
      : new MajordomeServerMoveError({
          message: problemOf(cause, fallback),
          ...(isMoveStepError(cause) && cause.canForce ? { canForce: true } : {}),
          ...(isPlainWordsError(cause) ? {} : { cause }),
        });

  /** One owner action at a time; each answers with the status it left behind. */
  const operation = <E>(fallback: string, effect: Effect.Effect<void, E>) =>
    operationLock
      .withPermits(1)(effect)
      .pipe(Effect.andThen(statusNow), Effect.mapError(toRpcError(fallback)));

  const start: MajordomeServerMove["Service"]["start"] = Effect.fn("MajordomeServerMove.start")(
    function* () {
      const move = yield* currentMove;
      if (move === null) return;
      if (move.phase === "removing") {
        yield* patchMove({
          phase: move.phaseBeforeRemoval ?? "failed",
          phaseBeforeRemoval: undefined,
        });
        return;
      }
      if (move.phase !== "running") return;
      // The step that was under way is run again; it finds what it already made.
      yield* forkRun;
    },
  );

  const saveKeys: MajordomeServerMove["Service"]["saveKeys"] = (input) =>
    operation(
      "The keys could not be saved.",
      Effect.gen(function* () {
        const problem =
          (input.hetznerToken === undefined ? null : hetznerTokenProblem(input.hetznerToken)) ??
          (input.tailscaleSecret === undefined
            ? null
            : tailscaleSecretProblem(input.tailscaleSecret));
        if (problem !== null) return yield* new MoveStepError({ message: problem });
        if (input.hetznerToken !== undefined) {
          yield* writeSecret(HETZNER_TOKEN_SECRET, input.hetznerToken);
        }
        if (input.tailscaleSecret !== undefined) {
          yield* writeSecret(TAILSCALE_SECRET, input.tailscaleSecret);
        }
        yield* refreshKeys;
      }),
    );

  const forgetKeys: MajordomeServerMove["Service"]["forgetKeys"] = () =>
    operation(
      "The keys could not be forgotten.",
      Effect.gen(function* () {
        if ((yield* currentMove)?.phase === "running") {
          return yield* new MoveStepError({
            message: "The keys are in use until the setup finishes.",
          });
        }
        yield* dropSecret(HETZNER_TOKEN_SECRET);
        yield* dropSecret(TAILSCALE_SECRET);
        yield* refreshKeys;
      }),
    );

  const check: MajordomeServerMove["Service"]["check"] = (input) =>
    diagnose({ projectId: input.projectId, probe: true }).pipe(
      Effect.mapError(toRpcError("The check could not finish.")),
    );

  const begin: MajordomeServerMove["Service"]["begin"] = (input) =>
    operation(
      "The setup could not start.",
      Effect.gen(function* () {
        if ((yield* currentMove) !== null) {
          return yield* new MoveStepError({
            message: "A server was already set up from here. Remove it before making another.",
          });
        }
        const vault = yield* vaultOf(input.projectId);
        if (vault === undefined) {
          return yield* new MoveStepError({ message: "Choose a notes folder to move first." });
        }
        const move: MoveRecord = {
          id: yield* random
            .uuidV4()
            .pipe(
              Effect.mapError(
                (cause) => new MoveStepError({ message: "The setup could not start.", cause }),
              ),
            ),
          projectId: input.projectId,
          vaultRoot: vault.root,
          title: vault.title,
          startedAt: isoTime(yield* Clock.currentTimeMillis),
          location: input.location,
          phase: "running",
          steps: STEP_ORDER.map((id) => ({ id, state: "pending" as const })),
          routinesOnServer: false,
        };
        yield* Effect.forEach([AUTH_KEY_SECRET, SETUP_SECRET, SESSION_SECRET], dropSecret, {
          discard: true,
        });
        yield* updateLedger(() => ({ move, removal: null }));
        yield* forkRun;
      }),
    );

  const retry: MajordomeServerMove["Service"]["retry"] = () =>
    operation(
      "The setup could not be tried again.",
      Effect.gen(function* () {
        const move = yield* requireMove;
        if (move.phase !== "failed") return;
        yield* patchMove({
          phase: "running",
          steps: move.steps.map((step) =>
            step.state === "done" ? step : { id: step.id, state: "pending" as const },
          ),
        });
        yield* forkRun;
      }),
    );

  const cancel: MajordomeServerMove["Service"]["cancel"] = (input) =>
    operation(
      "The setup could not be stopped.",
      Effect.gen(function* () {
        const move = yield* requireMove;
        if (move.phase !== "running" && move.phase !== "failed") {
          return yield* new MoveStepError({
            message: "The server is already set up. Use Remove this server to take it down.",
          });
        }
        yield* stopRun;
        const stopped = yield* requireMove;
        yield* patchMove({
          phase: "failed",
          steps: stopped.steps.map((step) =>
            step.state === "working"
              ? { id: step.id, state: "failed" as const, problem: "Stopped." }
              : step,
          ),
        });
        if (!input.keep) yield* takeDown(true);
      }),
    );

  const issuePairingLink: MajordomeServerMove["Service"]["issuePairingLink"] = Effect.fn(
    "MajordomeServerMove.issuePairingLink",
  )(
    function* () {
      const move = yield* requireMove;
      if (move.phase !== "ready") {
        return yield* new MoveStepError({ message: "The server is not ready yet." });
      }
      const session = yield* sessionFor(move);
      const issued = yield* issuePairingCredential(session.url, session.token, "Majordome").pipe(
        Effect.provide(services),
      );
      const pairingUrl = new URL("/pair", session.url);
      pairingUrl.hash = new URLSearchParams([["token", issued.credential]]).toString();
      return {
        pairingUrl: pairingUrl.toString(),
        expiresAt:
          typeof issued.expiresAt === "string"
            ? issued.expiresAt
            : isoTime((yield* Clock.currentTimeMillis) + Duration.toMillis(PAIRING_LINK_LIFETIME)),
      };
    },
    Effect.mapError(toRpcError("The server could not make a link.")),
  );

  const moveRoutines: MajordomeServerMove["Service"]["moveRoutines"] = () =>
    operation(
      "Routines could not be moved.",
      Effect.gen(function* () {
        const move = yield* requireMove;
        if (move.phase !== "ready" || move.environmentId === undefined) {
          return yield* new MoveStepError({ message: "The server is not ready yet." });
        }
        if (move.routinesOnServer) return;
        const session = yield* sessionFor(move);
        const there = yield* readRoutines(session.url, session.token);
        if (!there.canRun) {
          return yield* new MoveStepError({
            message:
              "Sign in to Claude or ChatGPT on the new server first: routines moved there now could not run.",
          });
        }
        yield* runRoutinesThere(session.url, session.token);
        // Written here too, so this computer stops at once instead of when the notes next sync.
        yield* vaultLock.withLock(
          move.vaultRoot,
          moveVaultRunner({
            vaultRoot: move.vaultRoot,
            environmentId: move.environmentId,
            serverLabel: move.serverLabel ?? move.serverName ?? SERVER_BASE_NAME,
          }),
        );
        yield* patchMove({ routinesOnServer: true });
      }).pipe(Effect.provide(services)),
    );

  const remove: MajordomeServerMove["Service"]["remove"] = (input) =>
    operation(
      "The server could not be removed.",
      Effect.gen(function* () {
        yield* stopRun;
        yield* takeDown(input.force);
      }),
    );

  return MajordomeServerMove.of({
    start,
    status: Effect.fn("MajordomeServerMove.status")(function* () {
      return yield* statusNow;
    }),
    changes: Stream.map(SubscriptionRef.changes(state), toStatus),
    saveKeys,
    forgetKeys,
    check,
    begin,
    retry,
    cancel,
    issuePairingLink,
    moveRoutines,
    remove,
  });
});

export const layer = Layer.effect(MajordomeServerMove, make());
