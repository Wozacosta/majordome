/**
 * Keeps a vault in step with the same vault on another of the owner's machines, with no git
 * remote between them. One machine holds the link and does the work each backup cycle: it asks the
 * other for what is new, puts its own saved changes on top, and sends them. The other only answers.
 * The session token lives in the secret store; everything else in this server's state dir.
 */

// @effect-diagnostics-next-line nodeBuiltinImport:off -- A synchronous digest names the secret.
import * as NodeCrypto from "node:crypto";

import type { MajordomeBackupPeer } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { fetchEnvironment } from "./moveRemote.ts";
import {
  fetchPeerNews,
  openPeerSession,
  type PeerRemoteError,
  type PeerRequest,
  renewPeerSession,
  sendPeerNews,
} from "./peerRemote.ts";
import * as VaultActiveRuns from "./VaultActiveRuns.ts";
import { autosaveVault, hasUnfinishedMerge } from "./vaultAutosave.ts";
import { makeVaultBrainIds } from "./vaultBrainId.ts";
import { VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";
import { findGitleaks } from "./vaultSecretScan.ts";
import {
  replayOnto,
  type SyncFailure,
  type SyncResult,
  type SyncTransport,
  syncVault,
} from "./vaultSync.ts";

/** What travels in a bundle, on the machine that made it. */
const OUTGOING_REF = "refs/majordome/sync-outgoing";
const INCOMING_REF = "refs/majordome/sync-incoming";
/** Sessions last 30 days; a new one is taken well before that, while the old one still works. */
const RENEW_SESSION_AFTER = Duration.days(20);
/** A sleeping laptop and a busy server both miss a cycle now and then; only this many in a row is a problem. */
const MISSES_BEFORE_PROBLEM = 3;
/** The answering machine counts as in step while the other has been in touch this recently. */
const HEARD_RECENTLY = Duration.minutes(15);

const PeerLink = Schema.Struct({
  url: Schema.String,
  environmentId: Schema.String,
  label: Schema.String,
  sessionAt: Schema.String,
  needsReconnect: Schema.optional(Schema.Boolean),
  problem: Schema.optional(Schema.String),
  misses: Schema.optional(Schema.Number),
  lastInStepAt: Schema.optional(Schema.String),
});
type PeerLink = typeof PeerLink.Type;

const VaultPeers = Schema.Struct({
  /** Present on the machine that does the work. */
  link: Schema.optional(PeerLink),
  /** The machine that last asked this one for its notes, or sent its own. */
  heardFrom: Schema.optional(
    Schema.Struct({
      label: Schema.String,
      environmentId: Schema.optional(Schema.String),
      at: Schema.String,
    }),
  ),
});
type VaultPeers = typeof VaultPeers.Type;

const PeerLedger = Schema.Struct({ vaults: Schema.Record(Schema.String, VaultPeers) });
type PeerLedger = typeof PeerLedger.Type;
const PeerLedgerJson = Schema.fromJsonString(PeerLedger);
const decodeLedger = Schema.decodeUnknownOption(PeerLedgerJson);
const encodeLedger = Schema.encodeSync(PeerLedgerJson);

/** Why two machines could not be linked. There is no `cause`: requests hold credentials. */
export class PeerLinkError extends Schema.TaggedError<PeerLinkError>()("PeerLinkError", {
  reason: Schema.Literals([
    "bad-address",
    "no-notes",
    "this-machine",
    "unreachable",
    "signed-out",
    "outdated",
    "other-notes",
    "failed",
  ]),
  label: Schema.String,
}) {
  override get message(): string {
    switch (this.reason) {
      case "bad-address":
        return `The address for ${this.label} is not one Majordome can use.`;
      case "no-notes":
        return "These notes have no saved changes yet, so there is nothing to keep in step.";
      case "this-machine":
        return "That address is this same machine.";
      case "unreachable":
        return `Could not reach ${this.label}. Check that it is on and that both machines are on your private network.`;
      case "signed-out":
        return `${this.label} did not accept the connection. Try again.`;
      case "outdated":
        return outdatedProblem(this.label);
      case "other-notes":
        return `${this.label} does not hold these notes.`;
      case "failed":
        return `Could not link with ${this.label}.`;
    }
  }
}

/** What the answering machine says when it will not take or give notes. */
export class PeerSyncRefusal extends Schema.TaggedError<PeerSyncRefusal>()("PeerSyncRefusal", {
  reason: Schema.Literals(["unknown-notes", "other-notes", "moved", "failed"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "unknown-notes":
        return "This machine does not hold those notes.";
      case "other-notes":
        return "What was sent belongs to different notes, so it was not added.";
      case "moved":
        return "The notes here changed in the meantime, so nothing was added. Try again.";
      case "failed":
        return "This machine could not keep the notes in step.";
    }
  }
}

const isPeerSyncRefusal = Schema.is(PeerSyncRefusal);
const refused = (cause: unknown) =>
  isPeerSyncRefusal(cause) ? cause : new PeerSyncRefusal({ reason: "failed", cause });

const outdatedProblem = (label: string) =>
  `${label} runs an older Majordome that cannot keep notes in step directly. Update Majordome there.`;

/** The ref that holds the last commit the other machine is known to have. */
export const peerRef = (environmentId: string) =>
  `refs/majordome/peer/${environmentId.replaceAll(/[^A-Za-z0-9._-]/g, "-")}`;

/** The session token's name in the secret store: the vault's folder, hashed. */
export const peerSessionSecret = (vaultRoot: string) =>
  `majordome-peer-session-${NodeCrypto.createHash("sha256").update(vaultRoot).digest("hex").slice(0, 24)}`;

/** Who is asking, as the other machine names itself. */
export interface PeerCaller {
  readonly label: string;
  readonly environmentId?: string;
}

export class MajordomePeerSync extends Context.Service<
  MajordomePeerSync,
  {
    /** Links this machine's vault with the same vault at `url`, spending a pairing credential. */
    readonly link: (input: {
      readonly vaultRoot: string;
      readonly url: string;
      readonly credential: string;
      readonly label: string;
    }) => Effect.Effect<void, PeerLinkError>;
    /** The same, from an owner session this machine already holds there. */
    readonly linkWithSession: (input: {
      readonly vaultRoot: string;
      readonly url: string;
      readonly token: string;
      readonly label: string;
      readonly environmentId: string;
    }) => Effect.Effect<void, PeerLinkError>;
    readonly unlink: (vaultRoot: string) => Effect.Effect<void>;
    /** One exchange with the linked machine; null when the vault has no link. */
    readonly sync: (input: {
      readonly vaultRoot: string;
      readonly gitleaks: string | null;
      /** See `syncVault`: the backup's ref, whose saved changes are never replayed. */
      readonly published: string | null;
    }) => Effect.Effect<SyncResult | null>;
    readonly status: (vaultRoot: string) => Effect.Effect<MajordomeBackupPeer | null>;
    /**
     * The answering side: writes what this machine has beyond `have` to `bundlePath`, unless it
     * has nothing new, and says which commit it is at.
     */
    readonly offer: (input: {
      readonly brainId: string;
      readonly have: string | null;
      readonly bundlePath: string;
      readonly from: PeerCaller;
    }) => Effect.Effect<{ readonly head: string; readonly packed: boolean }, PeerSyncRefusal>;
    /**
     * The answering side: adds the bundle's changes on top of this machine's, only ever forward.
     * With `replay`, changes made here meanwhile are put on top of what arrived instead.
     */
    readonly accept: (input: {
      readonly brainId: string;
      readonly bundlePath: string;
      readonly replay: boolean;
      readonly from: PeerCaller;
    }) => Effect.Effect<{ readonly head: string }, PeerSyncRefusal>;
  }
>()("t3/majordome/MajordomePeerSync") {}

const isoTime = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const vaultLock = yield* VaultLock.VaultLock;
  const activeRuns = yield* VaultActiveRuns.VaultActiveRuns;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const services = yield* Effect.context<
    | FileSystem.FileSystem
    | Path.Path
    | GitVcsDriver.GitVcsDriver
    | ProcessRunner.ProcessRunner
    | HttpClient.HttpClient
  >();
  // "Samys-MacBook-Pro.local" reads as "Samys MacBook Pro" in a file name.
  const machineName = (yield* HostProcess.Hostname).split(".")[0]!.replaceAll("-", " ");
  const ledgerPath = path.join(config.stateDir, "majordome", "peers.json");
  const ledgerLock = yield* Semaphore.make(1);
  const ledger = yield* Ref.make<PeerLedger>(
    Option.getOrElse(
      decodeLedger(
        yield* fileSystem.readFileString(ledgerPath).pipe(Effect.orElseSucceed(() => "")),
      ),
      (): PeerLedger => ({ vaults: {} }),
    ),
  );
  const brainIdOf = makeVaultBrainIds();

  const readState = (vaultRoot: string) =>
    Effect.map(Ref.get(ledger), (current): VaultPeers => current.vaults[vaultRoot] ?? {});

  const updateState = (vaultRoot: string, change: (state: VaultPeers) => VaultPeers) =>
    ledgerLock.withPermits(1)(
      Effect.gen(function* () {
        const next = yield* Ref.updateAndGet(ledger, (current) => ({
          vaults: { ...current.vaults, [vaultRoot]: change(current.vaults[vaultRoot] ?? {}) },
        }));
        const temp = `${ledgerPath}.tmp`;
        yield* fileSystem.makeDirectory(path.dirname(ledgerPath), { recursive: true });
        yield* fileSystem.writeFileString(temp, encodeLedger(next));
        yield* fileSystem.rename(temp, ledgerPath);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "Majordome could not record which machine the notes are in step with.",
            {
              cause,
            },
          ),
        ),
      ),
    );

  /** Changes the link, when the vault still has one. */
  const patchLink = (vaultRoot: string, change: (link: PeerLink) => PeerLink) =>
    updateState(vaultRoot, (state) =>
      state.link === undefined ? state : { ...state, link: change(state.link) },
    );

  const run = (cwd: string, args: ReadonlyArray<string>) =>
    git.execute({
      operation: "majordome.peerSync",
      cwd,
      args,
      allowNonZeroExit: true,
      timeoutMs: 10 * 60_000,
    });
  const revParse = (cwd: string, ref: string) =>
    run(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).pipe(
      Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : null)),
      Effect.orElseSucceed(() => null),
    );

  const readToken = (vaultRoot: string) =>
    secrets.get(peerSessionSecret(vaultRoot)).pipe(
      Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
      Effect.orElseSucceed(() => Option.none<string>()),
    );
  const writeToken = (vaultRoot: string, token: string) =>
    secrets.set(peerSessionSecret(vaultRoot), new TextEncoder().encode(token));

  const caller = Effect.map(environment.getDescriptor, (descriptor) => ({
    label: descriptor.label,
    environmentId: descriptor.environmentId as string,
  }));
  const sessionLabel = Effect.map(caller, (self) => `Majordome on ${self.label}`);

  const storeLink = Effect.fn("MajordomePeerSync.storeLink")(function* (input: {
    readonly vaultRoot: string;
    readonly url: string;
    readonly token: string;
    readonly label: string;
    readonly environmentId: string;
  }) {
    yield* writeToken(input.vaultRoot, input.token).pipe(
      Effect.mapError(() => new PeerLinkError({ reason: "failed", label: input.label })),
    );
    const previous = (yield* readState(input.vaultRoot)).link;
    const sessionAt = isoTime(yield* Clock.currentTimeMillis);
    yield* updateState(input.vaultRoot, (state) => ({
      ...state,
      link: {
        url: input.url,
        environmentId: input.environmentId,
        label: input.label,
        sessionAt,
        // Linking again with the same machine keeps when the two were last in step.
        ...(previous?.environmentId === input.environmentId && previous.lastInStepAt !== undefined
          ? { lastInStepAt: previous.lastInStepAt }
          : {}),
      },
    }));
  });

  /**
   * Brings the other machine's head into `ref`. False when what it sent could not be read.
   */
  const bring = Effect.fn("MajordomePeerSync.bring")(function* (
    vaultRoot: string,
    request: PeerRequest,
    ref: string,
  ) {
    const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-peer-" });
    const bundlePath = path.join(temp, "news.bundle");
    const known = yield* revParse(vaultRoot, ref);
    // Before the first exchange, this machine's own notes are the best guess.
    const news = yield* fetchPeerNews({
      ...request,
      have: known ?? (yield* revParse(vaultRoot, "HEAD")),
      targetPath: bundlePath,
    });
    if (news.arrived) {
      const fetched = yield* run(vaultRoot, [
        "fetch",
        "--quiet",
        bundlePath,
        `+${OUTGOING_REF}:${ref}`,
      ]);
      return fetched.exitCode === 0;
    }
    if (news.head !== known && (yield* revParse(vaultRoot, news.head)) !== null) {
      yield* run(vaultRoot, ["update-ref", ref, news.head]);
    }
    return true;
  }, Effect.scoped);

  const link: MajordomePeerSync["Service"]["link"] = Effect.fn("MajordomePeerSync.link")(function* (
    input,
  ) {
    const { label, vaultRoot } = input;
    const fail = (reason: PeerLinkError["reason"]) => new PeerLinkError({ reason, label });
    const url = yield* Effect.try({
      try: () => new URL(input.url),
      catch: () => fail("bad-address"),
    });
    // An address on this machine is the app's own tunnel, which closes with the app.
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname)
    ) {
      return yield* fail("bad-address");
    }
    const brainId = yield* brainIdOf(vaultRoot);
    if (brainId === null) return yield* fail("no-notes");
    const self = yield* caller;
    const answering = yield* fetchEnvironment(url.origin);
    if (Option.isNone(answering)) return yield* fail("unreachable");
    if (answering.value.environmentId === self.environmentId) return yield* fail("this-machine");
    const token = yield* openPeerSession(url.origin, {
      credential: input.credential,
      label: yield* sessionLabel,
    }).pipe(
      Effect.mapError((error) =>
        fail(error.reason === "unreachable" ? "unreachable" : "signed-out"),
      ),
    );
    // Asking for what is new proves the other machine answers and holds these same notes.
    yield* bring(
      vaultRoot,
      { url: url.origin, token, brainId, from: self },
      peerRef(answering.value.environmentId),
    ).pipe(
      Effect.catchTags({
        PeerRemoteError: (error) =>
          Effect.fail(
            fail(
              error.reason === "refused"
                ? "other-notes"
                : error.reason === "moved"
                  ? "failed"
                  : error.reason,
            ),
          ),
      }),
      Effect.mapError((error) => (error._tag === "PeerLinkError" ? error : fail("failed"))),
    );
    yield* storeLink({
      vaultRoot,
      url: url.origin,
      token,
      label,
      environmentId: answering.value.environmentId,
    });
  }, Effect.provide(services));

  const linkWithSession: MajordomePeerSync["Service"]["linkWithSession"] = Effect.fn(
    "MajordomePeerSync.linkWithSession",
  )(function* (input) {
    // Its own session, so removing the one it came from does not end the link.
    const token = yield* renewPeerSession(input.url, input.token, yield* sessionLabel).pipe(
      Effect.mapError(
        (error) =>
          new PeerLinkError({
            reason:
              error.reason === "unreachable" || error.reason === "signed-out"
                ? error.reason
                : "failed",
            label: input.label,
          }),
      ),
    );
    yield* storeLink({ ...input, token });
  }, Effect.provide(services));

  const unlink: MajordomePeerSync["Service"]["unlink"] = Effect.fn("MajordomePeerSync.unlink")(
    function* (vaultRoot) {
      const linked = (yield* readState(vaultRoot)).link;
      yield* secrets.remove(peerSessionSecret(vaultRoot)).pipe(Effect.ignore);
      yield* updateState(vaultRoot, ({ link: _, ...rest }) => rest);
      if (linked !== undefined) {
        yield* run(vaultRoot, ["update-ref", "-d", peerRef(linked.environmentId)]).pipe(
          Effect.ignore,
        );
      }
    },
  );

  /** What to tell the owner when the other machine could not be asked, and when to say it. */
  const recordTrouble = Effect.fn("MajordomePeerSync.recordTrouble")(function* (
    vaultRoot: string,
    reason: PeerRemoteError["reason"],
    detail: string | undefined,
  ) {
    yield* patchLink(vaultRoot, (current) => {
      const { label } = current;
      const misses = (current.misses ?? 0) + 1;
      const patient = (problem: string) => ({
        ...current,
        misses,
        ...(misses >= MISSES_BEFORE_PROBLEM ? { problem } : {}),
      });
      switch (reason) {
        case "signed-out":
          return {
            ...current,
            needsReconnect: true,
            problem: `${label} no longer accepts this computer. Open Majordome on this computer while ${label} is connected, and the two are linked again.`,
          };
        case "outdated":
          return { ...current, problem: outdatedProblem(label) };
        case "refused":
          return { ...current, problem: detail ?? `${label} did not accept the notes.` };
        case "unreachable":
          return patient(`Could not reach ${label}. Majordome tries again every few minutes.`);
        case "moved":
          return patient(
            `The notes on ${label} keep changing while this computer sends its own. Majordome keeps trying.`,
          );
        case "failed":
          return patient(
            `${label} could not take the notes. Majordome tries again every few minutes.`,
          );
      }
    });
  });

  /** A session about to run out is replaced while it still works. */
  const freshToken = Effect.fn("MajordomePeerSync.freshToken")(function* (
    vaultRoot: string,
    linked: PeerLink,
    token: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const age = now - Date.parse(linked.sessionAt);
    if (!(age > Duration.toMillis(RENEW_SESSION_AFTER))) return token;
    const renewed = yield* renewPeerSession(linked.url, token, yield* sessionLabel).pipe(
      Effect.option,
    );
    if (Option.isNone(renewed)) return token;
    const stored = yield* writeToken(vaultRoot, renewed.value).pipe(Effect.result);
    if (stored._tag === "Failure") return token;
    yield* patchLink(vaultRoot, (current) => ({ ...current, sessionAt: isoTime(now) }));
    return renewed.value;
  });

  const sync: MajordomePeerSync["Service"]["sync"] = Effect.fn("MajordomePeerSync.sync")(function* (
    input,
  ) {
    const { vaultRoot } = input;
    const linked = (yield* readState(vaultRoot)).link;
    if (linked === undefined) return null;
    const brainId = yield* brainIdOf(vaultRoot);
    if (brainId === null) return null;
    const stored = yield* readToken(vaultRoot);
    if (Option.isNone(stored)) {
      yield* recordTrouble(vaultRoot, "signed-out", undefined);
      return { status: "failed", message: "The other machine needs linking again." } as const;
    }
    const request: PeerRequest = {
      url: linked.url,
      token: yield* freshToken(vaultRoot, linked, stored.value),
      brainId,
      from: yield* caller,
    };
    const ref = peerRef(linked.environmentId);
    let trouble: PeerRemoteError | undefined;
    const failed = (error?: { readonly _tag: string }): Effect.Effect<SyncFailure> =>
      Effect.sync(() => {
        if (error?._tag === "PeerRemoteError") trouble = error as PeerRemoteError;
        return { status: "failed", message: "Could not keep the notes in step." };
      });
    const transport: SyncTransport = {
      ref,
      bring: bring(vaultRoot, request, ref).pipe(
        Effect.flatMap((brought) => (brought ? Effect.succeed(null) : failed())),
        Effect.catch(failed),
        Effect.provide(services),
      ),
      send: (head, options) =>
        Effect.scoped(
          Effect.gen(function* () {
            const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-peer-" });
            const bundlePath = path.join(temp, "news.bundle");
            const known = yield* revParse(vaultRoot, ref);
            yield* run(vaultRoot, ["update-ref", OUTGOING_REF, head]);
            const bundled = yield* run(vaultRoot, [
              "bundle",
              "create",
              "--quiet",
              bundlePath,
              OUTGOING_REF,
              ...(known === null ? [] : [`^${known}`]),
            ]);
            if (bundled.exitCode !== 0) return yield* failed();
            yield* sendPeerNews({ ...request, bundlePath, theyReplay: options.theyReplay });
            // The other machine holds `head` now, whatever it added on top.
            yield* run(vaultRoot, ["update-ref", ref, head]);
            return "sent" as const;
          }),
        ).pipe(
          Effect.catch((error): Effect.Effect<"moved" | SyncFailure> =>
            error._tag === "PeerRemoteError" && error.reason === "moved"
              ? Effect.succeed("moved")
              : failed(error),
          ),
          Effect.provide(services),
        ),
    };
    const now = yield* Clock.currentTimeMillis;
    const result = yield* syncVault({
      cwd: vaultRoot,
      transport,
      gitleaks: input.gitleaks,
      published: input.published,
      local: (effect) => vaultLock.withLock(vaultRoot, effect),
      machineName,
      today: DateTime.formatIsoDate(
        DateTime.makeZonedUnsafe(now, { timeZone: DateTime.zoneMakeLocal() }),
      ),
    }).pipe(
      Effect.provide(services),
      Effect.catchCause((cause) =>
        Effect.logWarning("Majordome could not keep a vault in step with another machine.", {
          vaultRoot,
          cause,
        }).pipe(Effect.as({ status: "failed", message: "Keeping in step stopped." } as SyncResult)),
      ),
    );
    if (result.status === "synced") {
      yield* patchLink(vaultRoot, ({ problem: _, needsReconnect: __, misses: ___, ...kept }) => ({
        ...kept,
        lastInStepAt: isoTime(now),
      }));
    } else if (result.status === "moved" || result.status === "failed") {
      const known: PeerRemoteError | undefined = trouble;
      yield* recordTrouble(
        vaultRoot,
        known?.reason ?? (result.status === "moved" ? "moved" : "failed"),
        known?.detail,
      );
    }
    return result;
  }, Effect.provide(services));

  const status: MajordomePeerSync["Service"]["status"] = Effect.fn("MajordomePeerSync.status")(
    function* (vaultRoot) {
      const state = yield* readState(vaultRoot);
      if (state.link !== undefined) {
        const linked = state.link;
        const head = yield* revParse(vaultRoot, "HEAD");
        return {
          label: linked.label,
          environmentId: linked.environmentId,
          linkedHere: true,
          inStep:
            linked.needsReconnect !== true &&
            linked.problem === undefined &&
            head !== null &&
            head === (yield* revParse(vaultRoot, peerRef(linked.environmentId))),
          lastInStepAt: linked.lastInStepAt ?? null,
          problem: linked.problem ?? null,
          needsReconnect: linked.needsReconnect === true,
        };
      }
      if (state.heardFrom === undefined) return null;
      const heard = state.heardFrom;
      const quiet = (yield* Clock.currentTimeMillis) - Date.parse(heard.at);
      return {
        label: heard.label,
        environmentId: heard.environmentId ?? null,
        linkedHere: false,
        inStep: quiet < Duration.toMillis(HEARD_RECENTLY),
        lastInStepAt: heard.at,
        problem: null,
        needsReconnect: false,
      };
    },
    Effect.provide(services),
  );

  /** The vault among this server's projects that is a copy of the brain. */
  const vaultOf = Effect.fn("MajordomePeerSync.vaultOf")(function* (brainId: string) {
    for (const project of yield* projects.list()) {
      const root = project.workspaceRoot;
      if (!(yield* fileSystem.exists(path.join(root, VAULT_CONFIG_DIRNAME)))) continue;
      if ((yield* brainIdOf(root)) === brainId) return root;
    }
    return yield* new PeerSyncRefusal({ reason: "unknown-notes" });
  });

  const heard = Effect.fn("MajordomePeerSync.heard")(function* (
    vaultRoot: string,
    from: PeerCaller,
  ) {
    const at = isoTime(yield* Clock.currentTimeMillis);
    yield* updateState(vaultRoot, (state) => ({
      ...state,
      heardFrom: {
        label: from.label.slice(0, 120),
        ...(from.environmentId === undefined ? {} : { environmentId: from.environmentId }),
        at,
      },
    }));
  });

  const saveHere = Effect.fn("MajordomePeerSync.saveHere")(function* (vaultRoot: string) {
    // A run's half-made changes are its own to save, as in the backup cycle.
    if (yield* activeRuns.isBusy(vaultRoot)) return;
    const gitleaks = yield* findGitleaks().pipe(Effect.orElseSucceed(() => null));
    // A paused save sends or keeps what is committed.
    yield* autosaveVault({ cwd: vaultRoot, gitleaks }).pipe(Effect.ignore);
  });

  const offer: MajordomePeerSync["Service"]["offer"] = Effect.fn("MajordomePeerSync.offer")(
    function* (input) {
      const vaultRoot = yield* vaultOf(input.brainId);
      const packed = yield* vaultLock.withLock(
        vaultRoot,
        Effect.gen(function* () {
          yield* saveHere(vaultRoot);
          const head = yield* revParse(vaultRoot, "HEAD");
          if (head === null) return yield* new PeerSyncRefusal({ reason: "unknown-notes" });
          // A commit this machine has never seen means the asker gets the whole history.
          const have = input.have === null ? null : yield* revParse(vaultRoot, input.have);
          if (have !== null) {
            const news = yield* run(vaultRoot, ["rev-list", "--count", head, `^${have}`]);
            if (Number(news.stdout.trim()) === 0) return { head, packed: false };
          }
          yield* run(vaultRoot, ["update-ref", OUTGOING_REF, head]);
          const bundled = yield* run(vaultRoot, [
            "bundle",
            "create",
            "--quiet",
            input.bundlePath,
            OUTGOING_REF,
            ...(have === null ? [] : [`^${have}`]),
          ]);
          if (bundled.exitCode !== 0) return yield* new PeerSyncRefusal({ reason: "failed" });
          return { head, packed: true };
        }),
      );
      yield* heard(vaultRoot, input.from);
      return packed;
    },
    Effect.provide(services),
    Effect.mapError(refused),
  );

  const accept: MajordomePeerSync["Service"]["accept"] = Effect.fn("MajordomePeerSync.accept")(
    function* (input) {
      const vaultRoot = yield* vaultOf(input.brainId);
      const fetched = yield* run(vaultRoot, [
        "fetch",
        "--quiet",
        input.bundlePath,
        `+${OUTGOING_REF}:${INCOMING_REF}`,
      ]);
      if (fetched.exitCode !== 0) return yield* new PeerSyncRefusal({ reason: "failed" });
      const roots = yield* run(vaultRoot, [
        "rev-list",
        "--first-parent",
        "--max-parents=0",
        INCOMING_REF,
      ]);
      if (roots.stdout.trim().split("\n").at(-1) !== input.brainId) {
        return yield* new PeerSyncRefusal({ reason: "other-notes" });
      }
      const head = yield* vaultLock.withLock(
        vaultRoot,
        Effect.gen(function* () {
          const moved = new PeerSyncRefusal({ reason: "moved" });
          // Unsaved edits to a note that also arrived stop this, and nothing is touched.
          const forward = yield* run(vaultRoot, ["merge", "--quiet", "--ff-only", INCOMING_REF]);
          if (forward.exitCode !== 0) {
            if (!input.replay) return yield* moved;
            yield* saveHere(vaultRoot);
            const unsaved = yield* run(vaultRoot, ["status", "--porcelain"]);
            if (unsaved.stdout.trim() !== "" || (yield* hasUnfinishedMerge(vaultRoot))) {
              return yield* moved;
            }
            const replayed = yield* replayOnto({
              cwd: vaultRoot,
              onto: INCOMING_REF,
              machineName,
              today: DateTime.formatIsoDate(
                DateTime.makeZonedUnsafe(yield* Clock.currentTimeMillis, {
                  timeZone: DateTime.zoneMakeLocal(),
                }),
              ),
            });
            if (replayed.status !== "replayed") return yield* moved;
          }
          const now = yield* revParse(vaultRoot, "HEAD");
          return now ?? (yield* new PeerSyncRefusal({ reason: "failed" }));
        }),
      );
      yield* heard(vaultRoot, input.from);
      return { head };
    },
    Effect.provide(services),
    Effect.mapError(refused),
  );

  return MajordomePeerSync.of({ link, linkWithSession, unlink, sync, status, offer, accept });
});

export const layer = Layer.effect(MajordomePeerSync, make);
