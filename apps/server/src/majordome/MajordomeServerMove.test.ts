import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  type MajordomeServerMoveStatus,
  type MajordomeServerMoveStepId,
  ProjectId,
} from "@t3tools/contracts";
import type { TailscaleStatus } from "@t3tools/tailscale";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { fakeHttp, type FakeReply, type SentRequest } from "./fakeHttp.testkit.ts";
import { GITHUB_TOKEN_SECRET } from "./MajordomeBackup.ts";
import * as MajordomeRoutines from "./MajordomeRoutines.ts";
import * as MajordomeServerMove from "./MajordomeServerMove.ts";
import * as VaultActiveRuns from "./VaultActiveRuns.ts";
import { readVaultBrainId } from "./vaultBrainId.ts";
import { createVaultBundle } from "./vaultFolderBackup.ts";
import * as VaultLock from "./VaultLock.ts";
import { readVaultRunner } from "./vaultRunner.ts";
import { cloneElsewhere, commitAll, gitIn, makeVault } from "./vaultTestRepos.ts";

const baseLayer = Layer.mergeAll(
  GitVcsDriver.layer,
  ProcessRunner.layer,
  VaultLock.layer,
  VaultActiveRuns.layerIdle,
).pipe(
  // The driver reads the server's config; each test's own computer, below, replaces it.
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-move-base-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

/** One computer's state folder and secret store, kept across "restarts" within a test. */
const computer = () =>
  Layer.fresh(
    ServerSecretStore.layer.pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-move-" })),
    ),
  );

const projectId = ProjectId.make("vault-project");
const HERE = EnvironmentId.make("env-mac");
const THERE = EnvironmentId.make("env-server");
const HETZNER_TOKEN = "HetznerToken0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP";
const TAILSCALE_SECRET = "tskey-client-kCLIENT1CNTRL-ClientSecretPart0123456789";
const AUTH_KEY = "tskey-auth-kKEY1CNTRL-AuthKeySecretPart0123";
const SESSION = "session-token-0123456789";
const PAIRING_CODE = "PAIRCODE2345";
const TAILNET = "tail1234.ts.net";

const signedIn: TailscaleStatus = {
  running: true,
  magicDnsName: `macbook.${TAILNET}`,
  tailnetIpv4Addresses: ["100.64.0.1"],
  httpsServeEnabled: true,
};

const hetznerError = (status: number, code: string): FakeReply => ({
  status,
  body: { error: { code, message: code, details: null } },
});

interface FakeServer {
  readonly id: number;
  readonly name: string;
  labels: Record<string, string>;
  readonly userData: string;
  readonly serverType: string;
  readonly firewallId: number;
}

/** Hetzner, Tailscale, GitHub's registry and the new server, in memory. */
function fakeWorld() {
  const world = {
    hetzner: {
      servers: new Map<number, FakeServer>(),
      firewalls: new Map<number, { id: number; name: string; labels: Record<string, string> }>(),
      nextId: 100,
      createFirewall: undefined as FakeReply | undefined,
      createServer: [] as Array<FakeReply>,
      firewallInUse: 0,
      deleted: [] as Array<string>,
    },
    tailscale: {
      devices: [{ nodeId: "nMAC", name: `macbook.${TAILNET}`, hostname: "macbook" }] as Array<{
        nodeId: string;
        name: string;
        hostname: string;
        tags?: Array<string>;
      }>,
      keys: new Set<string>(),
      rejectSecret: false,
      createKey: undefined as FakeReply | undefined,
      /** Whether the server shows up once Hetzner has made it, and under which name. */
      joins: true,
      joinedName: undefined as string | undefined,
      deletedDevices: [] as Array<string>,
    },
    registry: { manifestStatus: 200 },
    server: {
      answers: true,
      acceptsSecret: true,
      secretSpent: false,
      vault: (): FakeReply => ({ status: 500 }),
      uploads: [] as Array<SentRequest>,
      githubTokens: [] as Array<string>,
      canRun: false,
      ranRoutines: 0,
      bundle: undefined as Uint8Array | undefined,
    },
  };

  const envOf = (server: FakeServer, name: string) =>
    new RegExp(`^ +${name}=(.*)$`, "m").exec(server.userData)?.[1];
  const labelled = <T extends { labels: Record<string, string> }>(
    items: Iterable<T>,
    sent: SentRequest,
  ) => {
    const [key, value] = (sent.url.searchParams.get("label_selector") ?? "").split("=");
    return [...items].filter((item) => item.labels[key ?? ""] === value);
  };
  const page = { meta: { pagination: { next_page: null } } };
  const serverJson = (server: FakeServer) => ({
    id: server.id,
    name: server.name,
    status: "running",
    labels: server.labels,
    server_type: { name: server.serverType },
    public_net: { ipv4: { id: server.id + 7000, ip: "1.2.3.4" } },
  });
  const action = (id: number) => ({ id, status: "success", error: null });

  const hetzner = (sent: SentRequest): FakeReply => {
    const path = sent.url.pathname.slice("/v1".length);
    const id = Number(path.split("/")[2]);
    const state = world.hetzner;
    if (sent.headers.authorization !== `Bearer ${HETZNER_TOKEN}`) {
      return hetznerError(401, "unauthorized");
    }
    switch (`${sent.method} /${path.split("/")[1]}${Number.isNaN(id) ? "" : "/:id"}`) {
      case "GET /server_types":
        return {
          body: {
            ...page,
            server_types: [
              {
                id: 114,
                name: "cx23",
                cores: 2,
                memory: 4,
                disk: 40,
                cpu_type: "shared",
                architecture: "x86",
                prices: ["fsn1", "nbg1"].map((location) => ({
                  location,
                  price_hourly: { net: "0.0056", gross: "0.0067" },
                  price_monthly: { net: "3.4900", gross: "4.1500" },
                })),
                locations: [
                  { id: 1, name: "fsn1", deprecation: null, available: true },
                  { id: 2, name: "nbg1", deprecation: null, available: true },
                ],
              },
              {
                id: 109,
                name: "cpx22",
                cores: 2,
                memory: 4,
                disk: 80,
                cpu_type: "shared",
                architecture: "x86",
                prices: [
                  {
                    location: "fsn1",
                    price_hourly: { net: "0.01", gross: "0.012" },
                    price_monthly: { net: "5.99", gross: "7.1300" },
                  },
                ],
              },
            ],
          },
        };
      case "GET /locations":
        return {
          body: {
            ...page,
            locations: [
              {
                id: 1,
                name: "fsn1",
                country: "DE",
                city: "Falkenstein",
                network_zone: "eu-central",
              },
              { id: 2, name: "nbg1", country: "DE", city: "Nuremberg", network_zone: "eu-central" },
            ],
          },
        };
      case "GET /pricing":
        return {
          body: {
            pricing: {
              currency: "EUR",
              primary_ips: [
                {
                  type: "ipv4",
                  prices: ["fsn1", "nbg1"].map((location) => ({
                    location,
                    price_monthly: { net: "0.5000", gross: "0.6000" },
                  })),
                },
              ],
            },
          },
        };
      case "POST /firewalls": {
        if (state.createFirewall !== undefined) return state.createFirewall;
        const body = sent.json as { name: string; labels: Record<string, string> };
        const firewall = { id: state.nextId++, name: body.name, labels: body.labels };
        state.firewalls.set(firewall.id, firewall);
        return { status: 201, body: { firewall, actions: [] } };
      }
      case "GET /firewalls":
        return { body: { ...page, firewalls: labelled(state.firewalls.values(), sent) } };
      case "GET /firewalls/:id":
        return state.firewalls.has(id)
          ? { body: { firewall: state.firewalls.get(id) } }
          : hetznerError(404, "not_found");
      case "DELETE /firewalls/:id":
        if (!state.firewalls.has(id)) return hetznerError(404, "not_found");
        if (state.firewallInUse-- > 0) return hetznerError(422, "resource_in_use");
        state.firewalls.delete(id);
        state.deleted.push(`firewall ${id}`);
        return { status: 204 };
      case "POST /servers": {
        const scripted = state.createServer.shift();
        if (scripted !== undefined) return scripted;
        const body = sent.json as {
          name: string;
          server_type: string;
          labels: Record<string, string>;
          user_data: string;
          firewalls: Array<{ firewall: number }>;
        };
        const server: FakeServer = {
          id: state.nextId++,
          name: body.name,
          labels: body.labels,
          userData: body.user_data,
          serverType: body.server_type,
          firewallId: body.firewalls[0]!.firewall,
        };
        state.servers.set(server.id, server);
        return {
          status: 201,
          body: { server: serverJson(server), action: action(1), next_actions: [action(2)] },
        };
      }
      case "GET /servers":
        return {
          body: { ...page, servers: labelled(state.servers.values(), sent).map(serverJson) },
        };
      case "GET /servers/:id":
        return state.servers.has(id)
          ? { body: { server: serverJson(state.servers.get(id)!) } }
          : hetznerError(404, "not_found");
      case "DELETE /servers/:id":
        if (!state.servers.has(id)) return hetznerError(404, "not_found");
        state.servers.delete(id);
        state.deleted.push(`server ${id}`);
        return { body: { action: action(3) } };
      case "DELETE /primary_ips/:id":
        return hetznerError(404, "not_found");
      default:
        return hetznerError(404, "not_found");
    }
  };

  const tailscale = (sent: SentRequest): FakeReply => {
    const state = world.tailscale;
    const path = sent.url.pathname.slice("/api/v2".length);
    if (path === "/oauth/token") {
      return state.rejectSecret ||
        new URLSearchParams(sent.body).get("client_secret") !== TAILSCALE_SECRET
        ? { status: 401, body: { message: "invalid client" } }
        : { body: { access_token: "ts-access", token_type: "Bearer", expires_in: 3600 } };
    }
    if (sent.headers.authorization !== "Bearer ts-access") return { status: 401 };
    if (sent.method === "GET" && path === "/tailnet/-/devices") {
      const made = [...world.hetzner.servers.values()][0];
      const hostname = made === undefined ? undefined : envOf(made, "MAJORDOME_HOSTNAME");
      if (
        state.joins &&
        hostname !== undefined &&
        !state.devices.some((d) => d.nodeId === "nNEW")
      ) {
        state.devices.push({
          nodeId: "nNEW",
          name: `${state.joinedName ?? hostname}.${TAILNET}`,
          hostname,
          tags: ["tag:majordome"],
        });
      }
      return { body: { devices: state.devices } };
    }
    if (sent.method === "POST" && path === "/tailnet/-/keys") {
      if (state.createKey !== undefined) return state.createKey;
      state.keys.add("kKEY1CNTRL");
      return { body: { id: "kKEY1CNTRL", key: AUTH_KEY } };
    }
    if (sent.method === "DELETE" && path.startsWith("/tailnet/-/keys/")) {
      return state.keys.delete(path.split("/").at(-1)!) ? { body: {} } : { status: 404 };
    }
    if (sent.method === "DELETE" && path.startsWith("/device/")) {
      const nodeId = path.split("/").at(-1)!;
      state.devices = state.devices.filter((device) => device.nodeId !== nodeId);
      state.deletedDevices.push(nodeId);
      return { body: {} };
    }
    return { status: 404 };
  };

  const newServer = (sent: SentRequest): FakeReply => {
    const state = world.server;
    const made = [...world.hetzner.servers.values()][0];
    if (!state.answers || made === undefined) return { status: 502 };
    const authorized = sent.headers.authorization === `Bearer ${SESSION}`;
    switch (`${sent.method} ${sent.url.pathname}`) {
      case "GET /.well-known/t3/environment":
        return {
          body: {
            environmentId: THERE,
            label: "majordome",
            platform: { os: "linux", arch: "x64" },
            serverVersion: "1.4.2",
            capabilities: { repositoryIdentity: true },
          },
        };
      case "POST /oauth/token": {
        const offered = new URLSearchParams(sent.body).get("subject_token");
        if (
          !state.acceptsSecret ||
          state.secretSpent ||
          offered !== envOf(made, "MAJORDOME_SETUP_SECRET")
        ) {
          return { status: 401, body: { code: "invalid_credential" } };
        }
        state.secretSpent = true;
        return {
          body: {
            access_token: SESSION,
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "Bearer",
            expires_in: 2_592_000,
            scope: "access:write",
          },
        };
      }
      case "GET /api/auth/session":
        return { body: { authenticated: authorized } };
      case "POST /api/auth/pairing-token":
        return authorized
          ? {
              body: {
                id: "link-1",
                credential: PAIRING_CODE,
                expiresAt: "2026-11-16T10:05:00.000Z",
              },
            }
          : { status: 401 };
      case "POST /api/majordome/move/vault":
        if (!authorized) return { status: 401 };
        state.uploads.push(sent);
        return state.vault();
      case "GET /api/majordome/move/vault":
        if (!authorized) return { status: 401 };
        return state.bundle === undefined
          ? { status: 409, body: { reason: "no-notes", message: "The server has no notes yet." } }
          : { bytes: state.bundle };
      case "POST /api/majordome/move/github-token":
        if (!authorized) return { status: 401 };
        state.githubTokens.push((sent.json as { token: string }).token);
        return { status: 204 };
      case "GET /api/majordome/move/routines":
        return authorized ? { body: { canRun: state.canRun, runsHere: false } } : { status: 401 };
      case "POST /api/majordome/move/routines":
        if (!authorized) return { status: 401 };
        state.ranRoutines++;
        return { status: 204 };
      default:
        return { status: 404 };
    }
  };

  const answer = (sent: SentRequest): FakeReply => {
    switch (sent.url.host) {
      case "api.hetzner.cloud":
        return hetzner(sent);
      case "api.tailscale.com":
        return tailscale(sent);
      case "ghcr.io":
        return sent.url.pathname === "/token"
          ? { body: { token: "registry-token" } }
          : { status: world.registry.manifestStatus, body: {} };
      default:
        return sent.url.host.endsWith(TAILNET) ? newServer(sent) : { status: 404 };
    }
  };
  /** A request the test holds open, to act while the service is known to be waiting on it. */
  let held:
    | {
        readonly matches: (sent: SentRequest) => boolean;
        readonly reached: Deferred.Deferred<void>;
        readonly release: Deferred.Deferred<void>;
      }
    | undefined;
  const http = fakeHttp((sent) => {
    const hold = held;
    if (hold === undefined || !hold.matches(sent)) return answer(sent);
    held = undefined;
    return Deferred.succeed(hold.reached, undefined).pipe(
      Effect.andThen(Deferred.await(hold.release)),
      Effect.map(() => answer(sent)),
    );
  });
  const holdNext = Effect.fn("test.holdNext")(function* (matches: (sent: SentRequest) => boolean) {
    const reached = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    held = { matches, reached, release };
    return {
      reached: Deferred.await(reached),
      release: Deferred.succeed(release, undefined).pipe(Effect.asVoid),
    };
  });
  return { ...world, http, envOf, holdNext };
}

type World = ReturnType<typeof fakeWorld>;

/** The move service on this test's computer, for one vault, talking to the fake world. */
const startService = Effect.fn("test.startService")(function* (
  world: World,
  vaultRoot: string,
  options?: { readonly tailscale?: TailscaleStatus | "not-installed" | "unreadable" },
) {
  const ranHere: Array<ProjectId> = [];
  const service = yield* MajordomeServerMove.make({
    localTailscale: Effect.succeed(options?.tailscale ?? signedIn),
    timeZone: "Europe/Paris",
    version: "1.4.2",
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: (id) =>
            Effect.succeed(
              id === projectId
                ? Option.some({ projectId, title: "My notes", workspaceRoot: vaultRoot } as never)
                : Option.none(),
            ),
        }),
        Layer.mock(MajordomeRoutines.MajordomeRoutines)({
          runHere: (id) => Effect.sync(() => void ranHere.push(id)),
        }),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(HERE),
          getDescriptor: Effect.succeed({ label: "MacBook" } as never),
        }),
        Layer.succeed(HttpClient.HttpClient, world.http.client),
      ),
    ),
  );
  return { service, ranHere };
});

type Service = MajordomeServerMove.MajordomeServerMove["Service"];

/** The first status that satisfies `wanted`, from the service's own stream of changes. */
const awaitStatus = (service: Service, wanted: (status: MajordomeServerMoveStatus) => boolean) =>
  service.changes.pipe(
    Stream.filter(wanted),
    Stream.take(1),
    Stream.runCollect,
    Effect.map((statuses) => [...statuses][0]!),
  );
const awaitPhase = (service: Service, phase: string) =>
  awaitStatus(service, (status) => status.move?.phase === phase);
const stepStates = (status: MajordomeServerMoveStatus) =>
  Object.fromEntries((status.move?.steps ?? []).map((step) => [step.id, step.state]));
const failedStep = (status: MajordomeServerMoveStatus) =>
  status.move?.steps.find((step) => step.state === "failed");

const saveKeys = (service: Service) =>
  service.saveKeys({ hetznerToken: HETZNER_TOKEN, tailscaleSecret: TAILSCALE_SECRET });

/** A vault, a world that accepts it, and a service with both keys saved. */
const ready = Effect.fn("test.ready")(function* (options?: { readonly remote?: boolean }) {
  const vault = yield* makeVault(options);
  const world = fakeWorld();
  const head = yield* gitIn(vault.root, ["rev-parse", "HEAD"]);
  const brainId = yield* readVaultBrainId(vault.root);
  world.server.vault = () => ({ body: { projectId: "remote-project", head, brainId } });
  const { service, ranHere } = yield* startService(world, vault.root);
  yield* saveKeys(service);
  return { vault, world, service, ranHere };
});

const begin = (service: Service) => service.begin({ projectId, location: "fsn1" });

it.layer(baseLayer)("MajordomeServerMove", (it) => {
  it.effect("creates the server, joins it to the tailnet, pairs and copies the notes", () =>
    Effect.gen(function* () {
      const { vault, world, service } = yield* ready();

      const check = yield* service.check({ projectId });
      assert.deepStrictEqual(check.problems, []);
      assert.deepStrictEqual(check.locations, [
        {
          name: "fsn1",
          city: "Falkenstein",
          country: "DE",
          serverType: "cx23",
          monthlyPrice: "4.75",
        },
        {
          name: "nbg1",
          city: "Nuremberg",
          country: "DE",
          serverType: "cx23",
          monthlyPrice: "4.75",
        },
      ]);
      assert.strictEqual(check.defaultLocation, "nbg1");
      assert.strictEqual(check.currency, "EUR");
      assert.match(check.notices[0] ?? "", /not backed up to GitHub/);
      // The check made a firewall and a key to prove it may, and removed both.
      assert.strictEqual(world.hetzner.firewalls.size, 0);
      assert.strictEqual(world.tailscale.keys.size, 0);

      yield* begin(service);
      const done = yield* awaitPhase(service, "ready");
      assert.deepStrictEqual(stepStates(done), {
        check: "done",
        key: "done",
        server: "done",
        start: "done",
        pair: "done",
        notes: "done",
      });
      assert.deepStrictEqual(done.move?.server, {
        name: "majordome",
        location: "fsn1",
        serverType: "cx23",
        monthlyPrice: "4.75",
        currency: "EUR",
        url: `https://majordome.${TAILNET}`,
        environmentId: THERE,
      });
      assert.isFalse(done.move?.routinesOnServer);

      const [server] = [...world.hetzner.servers.values()];
      assert.strictEqual(server?.labels["managed-by"], "majordome");
      assert.strictEqual(server?.labels["majordome-move"], done.move?.id);
      assert.isTrue(world.hetzner.firewalls.has(server!.firewallId));
      assert.include(server!.userData, "image: ghcr.io/wozacosta/majordome:1.4.2\n");
      assert.strictEqual(world.envOf(server!, "TS_AUTHKEY"), AUTH_KEY);
      assert.strictEqual(world.envOf(server!, "TZ"), "Europe/Paris");
      assert.strictEqual(
        world.envOf(server!, "MAJORDOME_PUBLIC_URL"),
        `https://majordome.${TAILNET}`,
      );

      // The one-time key is deleted and the setup secret spent; neither stays on this computer.
      assert.strictEqual(world.tailscale.keys.size, 0);
      assert.isTrue(world.server.secretSpent);
      const upload = world.server.uploads[0]!;
      assert.strictEqual(upload.bodyTag, "Stream");
      assert.strictEqual(upload.url.searchParams.get("title"), "My notes");
      assert.strictEqual(upload.url.searchParams.get("user_email"), "owner@example.com");
      assert.isNull(upload.url.searchParams.get("remote_url"));
      assert.deepStrictEqual(world.server.githubTokens, []);

      const link = yield* service.issuePairingLink();
      assert.strictEqual(
        link.pairingUrl,
        `https://majordome.${TAILNET}/pair#token=${PAIRING_CODE}`,
      );
      assert.strictEqual(link.expiresAt, "2026-11-16T10:05:00.000Z");

      // Routines stay on this computer until the server can run them.
      const early = yield* Effect.flip(service.moveRoutines());
      assert.match(early.message, /Sign in to Claude or ChatGPT on the new server first/);
      assert.strictEqual(world.server.ranRoutines, 0);
      world.server.canRun = true;
      const moved = yield* service.moveRoutines();
      assert.isTrue(moved.move?.routinesOnServer);
      assert.strictEqual(world.server.ranRoutines, 1);
      assert.strictEqual(Option.getOrNull(yield* readVaultRunner(vault.root)), THERE);
    }).pipe(Effect.provide(computer())),
  );

  it.effect("sends the GitHub sign-in and remote along when the notes are backed up there", () =>
    Effect.gen(function* () {
      const { vault, world, service } = yield* ready({ remote: true });
      yield* gitIn(vault.root, [
        "remote",
        "set-url",
        "origin",
        "https://github.com/owner/majordome-brain.git",
      ]);
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      yield* secrets.set(GITHUB_TOKEN_SECRET, new TextEncoder().encode("gho_backup"));

      yield* begin(service);
      yield* awaitPhase(service, "ready");
      const upload = world.server.uploads[0]!;
      assert.strictEqual(upload.url.searchParams.get("remote_name"), "origin");
      assert.strictEqual(
        upload.url.searchParams.get("remote_url"),
        "https://github.com/owner/majordome-brain.git",
      );
      assert.deepStrictEqual(world.server.githubTokens, ["gho_backup"]);
      // GitHub's token goes over the paired connection, never through Hetzner.
      assert.notInclude([...world.hetzner.servers.values()][0]!.userData, "gho_backup");
    }).pipe(Effect.provide(computer())),
  );

  it.effect("picks a free name and uses the one Tailscale really gave the server", () =>
    Effect.gen(function* () {
      const { world, service } = yield* ready();
      world.tailscale.devices.push({
        nodeId: "nOLD",
        name: `majordome.${TAILNET}`,
        hostname: "majordome",
      });
      world.tailscale.joinedName = "majordome-2-1";
      yield* begin(service);
      const done = yield* awaitPhase(service, "ready");
      const [server] = [...world.hetzner.servers.values()];
      assert.strictEqual(world.envOf(server!, "MAJORDOME_HOSTNAME"), "majordome-2");
      assert.strictEqual(done.move?.server?.url, `https://majordome-2-1.${TAILNET}`);
    }).pipe(Effect.provide(computer())),
  );

  it.effect("tries the next server type when Hetzner has none free, and the next name", () =>
    Effect.gen(function* () {
      const { world, service } = yield* ready();
      world.hetzner.createServer = [
        hetznerError(409, "uniqueness_error"),
        hetznerError(412, "resource_unavailable"),
      ];
      yield* begin(service);
      const done = yield* awaitPhase(service, "ready");
      assert.strictEqual(done.move?.server?.serverType, "cpx22");
      assert.strictEqual(done.move?.server?.monthlyPrice, "7.73");
      const names = world.http.requests
        .filter((sent) => sent.route === "POST api.hetzner.cloud/v1/servers")
        .map((sent) => (sent.json as { name: string; server_type: string }).name);
      // The name found taken stays taken for the next type.
      assert.deepStrictEqual(names, ["majordome", "majordome-2", "majordome-2"]);
    }).pipe(Effect.provide(computer())),
  );

  it.effect.each<{
    readonly step: MajordomeServerMoveStepId;
    readonly breakIt: (world: World) => void;
    readonly problem: RegExp;
  }>([
    {
      step: "check",
      breakIt: (world) => void (world.registry.manifestStatus = 404),
      problem: /This version of Majordome \(1\.4\.2\) has no server version published/,
    },
    {
      step: "key",
      breakIt: (world) =>
        void (world.tailscale.createKey = { status: 403, body: { message: "not permitted" } }),
      problem: /missing a permission.*Auth Keys and Devices > Core/,
    },
    {
      step: "key",
      breakIt: (world) =>
        void (world.tailscale.createKey = {
          status: 400,
          body: { message: "requested tags [tag:majordome] are invalid or not permitted" },
        }),
      problem: /create a tag named majordome/,
    },
    {
      step: "server",
      breakIt: (world) => void (world.hetzner.createFirewall = hetznerError(403, "forbidden")),
      problem: /can only read.*Read & Write/,
    },
    {
      step: "server",
      breakIt: (world) =>
        void (world.hetzner.createServer = [hetznerError(403, "resource_limit_exceeded")]),
      problem: /reached its limit for servers/,
    },
    {
      step: "pair",
      breakIt: (world) => void (world.server.acceptsSecret = false),
      problem: /did not accept its one-time setup code/,
    },
    {
      step: "notes",
      breakIt: (world) =>
        void (world.server.vault = () => ({
          body: { projectId: "remote-project", head: "0".repeat(40), brainId: "0".repeat(40) },
        })),
      problem: /not the same as the ones on this computer/,
    },
    {
      step: "notes",
      breakIt: (world) =>
        void (world.server.vault = () => ({
          status: 409,
          body: { reason: "other-notes", message: "The server already holds different notes." },
        })),
      problem: /The server already holds different notes/,
    },
  ])("stops at $step with a reason the owner can act on, and resumes once fixed", (scenario) =>
    Effect.gen(function* () {
      const { vault, world, service } = yield* ready();
      const working = fakeWorld();
      scenario.breakIt(world);
      yield* begin(service);
      const failed = yield* awaitPhase(service, "failed");
      assert.strictEqual(failedStep(failed)?.id, scenario.step);
      assert.match(failedStep(failed)?.problem ?? "", scenario.problem);
      // Steps after the failed one never started.
      const order = failed.move!.steps.map((step) => step.state);
      assert.isTrue(order.slice(order.indexOf("failed") + 1).every((state) => state === "pending"));

      // The fix, as the owner would make it outside: the world behaves again.
      world.registry.manifestStatus = working.registry.manifestStatus;
      world.tailscale.createKey = undefined;
      world.hetzner.createFirewall = undefined;
      world.hetzner.createServer = [];
      world.server.acceptsSecret = true;
      const head = yield* gitIn(vault.root, ["rev-parse", "HEAD"]);
      const brainId = yield* readVaultBrainId(vault.root);
      world.server.vault = () => ({ body: { projectId: "remote-project", head, brainId } });
      yield* service.retry();
      const done = yield* awaitPhase(service, "ready");
      assert.isTrue(done.move!.steps.every((step) => step.state === "done"));
      assert.strictEqual(world.hetzner.servers.size, 1);
      assert.strictEqual(world.hetzner.firewalls.size, 1);
    }).pipe(Effect.provide(computer())),
  );

  it.effect("gives up waiting after 20 minutes and says how far the server got", () =>
    Effect.gen(function* () {
      const { world, service } = yield* ready();
      world.tailscale.joins = false;
      // Held once the server exists: by then the wait has started and its deadline is set.
      const polling = yield* world.holdNext(
        (sent) => sent.url.pathname.endsWith("/devices") && world.hetzner.servers.size > 0,
      );
      yield* begin(service);
      yield* polling.reached;
      yield* TestClock.adjust(Duration.minutes(21));
      yield* polling.release;
      const neverJoined = yield* awaitPhase(service, "failed");
      assert.match(failedStep(neverJoined)?.problem ?? "", /did not join your Tailscale network/);

      world.tailscale.joins = true;
      world.server.answers = false;
      const probing = yield* world.holdNext((sent) =>
        sent.url.pathname.endsWith("/t3/environment"),
      );
      yield* service.retry();
      yield* probing.reached;
      yield* TestClock.adjust(Duration.minutes(21));
      yield* probing.release;
      const silent = yield* awaitPhase(service, "failed");
      assert.match(
        failedStep(silent)?.problem ?? "",
        /joined your Tailscale network as majordome\.tail1234\.ts\.net but does not answer.*HTTPS Certificates.*tag:majordome/,
      );
      // Waiting made no second server.
      assert.strictEqual(world.hetzner.servers.size, 1);

      world.server.answers = true;
      yield* service.retry();
      yield* awaitPhase(service, "ready");
    }).pipe(Effect.provide(computer())),
  );

  it.effect("stopping removes what was made, unless the owner keeps it to try again", () =>
    Effect.gen(function* () {
      const { world, service } = yield* ready();
      world.tailscale.joins = false;
      yield* begin(service);
      yield* awaitStatus(service, (status) => stepStates(status).start === "working");

      const kept = yield* service.cancel({ keep: true });
      assert.strictEqual(kept.move?.phase, "failed");
      assert.deepStrictEqual(failedStep(kept), {
        id: "start",
        state: "failed",
        problem: "Stopped.",
      });
      assert.strictEqual(world.hetzner.servers.size, 1);

      // Hetzner lets go of the firewall a moment after the server; the removal waits for it.
      world.hetzner.firewallInUse = 2;
      const firstDelete = yield* world.holdNext(
        (sent) => sent.method === "DELETE" && sent.url.pathname.includes("/firewalls/"),
      );
      const stopping = yield* Effect.forkChild(service.cancel({ keep: false }));
      yield* firstDelete.reached;
      yield* firstDelete.release;
      yield* TestClock.adjust(Duration.seconds(10));
      const stopped = yield* Fiber.join(stopping);
      assert.isNull(stopped.move);
      assert.strictEqual(world.hetzner.servers.size, 0);
      assert.strictEqual(world.hetzner.firewalls.size, 0);
      assert.strictEqual(world.tailscale.keys.size, 0);
      assert.deepStrictEqual(stopped.removal?.did, [
        "Deleted the server majordome at Hetzner.",
        "Deleted its firewall at Hetzner.",
      ]);
      assert.deepStrictEqual(stopped.removal?.problems, []);

      // Nothing is left to block a fresh start.
      world.tailscale.joins = true;
      yield* begin(service);
      yield* awaitPhase(service, "ready");
    }).pipe(Effect.provide(computer())),
  );

  it.effect("picks a half-made server up after a restart instead of making another", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      const world = fakeWorld();
      const head = yield* gitIn(vault.root, ["rev-parse", "HEAD"]);
      const brainId = yield* readVaultBrainId(vault.root);
      world.server.vault = () => ({ body: { projectId: "remote-project", head, brainId } });
      world.tailscale.joins = false;

      const firstRun = yield* Scope.make();
      const first = yield* startService(world, vault.root).pipe(Scope.provide(firstRun));
      yield* saveKeys(first.service);
      yield* begin(first.service);
      yield* awaitStatus(first.service, (status) => stepStates(status).start === "working");
      // The computer goes down mid-wait.
      yield* Scope.close(firstRun, Exit.void);

      world.tailscale.joins = true;
      const second = yield* startService(world, vault.root);
      const afterRestart = yield* second.service.status();
      assert.strictEqual(afterRestart.move?.phase, "running");
      assert.strictEqual(afterRestart.move?.server?.name, "majordome");
      assert.deepStrictEqual(afterRestart.keys, { hetzner: true, tailscale: true });
      yield* second.service.start();
      const done = yield* awaitPhase(second.service, "ready");
      assert.isTrue(done.move!.steps.every((step) => step.state === "done"));
      assert.strictEqual(world.hetzner.servers.size, 1);
      assert.lengthOf(
        world.http.requests.filter((sent) => sent.route === "POST api.hetzner.cloud/v1/servers"),
        1,
      );
    }).pipe(Effect.provide(computer())),
  );

  it.effect("removing brings notes and routines back, then deletes only what it made", () =>
    Effect.gen(function* () {
      const { vault, world, service, ranHere } = yield* ready({ remote: true });
      const fs = yield* FileSystem.FileSystem;
      yield* begin(service);
      yield* awaitPhase(service, "ready");
      world.server.canRun = true;
      yield* service.moveRoutines();

      // The server's copy moved on: a routine wrote a note there.
      const serverCopy = yield* cloneElsewhere(vault.bare!);
      yield* fs.writeFileString(`${serverCopy}/from-server.md`, "written by a routine\n");
      yield* commitAll(serverCopy, "routine");
      const out = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-server-bundle-" });
      yield* createVaultBundle({ cwd: serverCopy, bundlePath: `${out}/server.bundle` });
      world.server.bundle = yield* fs.readFile(`${out}/server.bundle`);
      // Someone else's server in the same Hetzner project is not Majordome's to touch.
      world.hetzner.servers.set(900, {
        id: 900,
        name: "someone-elses",
        labels: {},
        userData: "",
        serverType: "cx23",
        firewallId: 0,
      });

      const removed = yield* service.remove({ force: false });
      assert.isNull(removed.move);
      assert.deepStrictEqual(removed.removal?.did, [
        "Copied the notes changed on the server back to this computer.",
        "Routines run on this computer again.",
        "Deleted the server majordome at Hetzner.",
        "Deleted its firewall at Hetzner.",
        "Removed majordome from your Tailscale network.",
      ]);
      assert.deepStrictEqual(removed.removal?.problems, []);
      assert.strictEqual(
        yield* fs.readFileString(`${vault.root}/from-server.md`),
        "written by a routine\n",
      );
      assert.deepStrictEqual(ranHere, [projectId]);
      assert.deepStrictEqual([...world.hetzner.servers.keys()], [900]);
      assert.strictEqual(world.hetzner.firewalls.size, 0);
      assert.deepStrictEqual(world.tailscale.deletedDevices, ["nNEW"]);
      const again = yield* Effect.flip(service.remove({ force: true }));
      assert.match(again.message, /no server set up from here/);
    }).pipe(Effect.provide(computer())),
  );

  it.effect("refuses to delete a server that does not carry this setup's label", () =>
    Effect.gen(function* () {
      const { world, service } = yield* ready();
      yield* begin(service);
      yield* awaitPhase(service, "ready");
      const [server] = [...world.hetzner.servers.values()];
      // The recorded id now names a server this setup did not label.
      server!.labels = { "managed-by": "someone-else" };

      const refused = yield* Effect.flip(service.remove({ force: true }));
      assert.match(refused.message, /was not made by this setup, so Majordome left it alone/);
      assert.strictEqual(world.hetzner.servers.size, 1);
      assert.deepStrictEqual(world.hetzner.deleted, []);
      assert.strictEqual((yield* service.status()).move?.phase, "ready");
    }).pipe(Effect.provide(computer())),
  );

  it.effect("asks before removing a server whose notes it cannot copy back", () =>
    Effect.gen(function* () {
      const { world, service } = yield* ready();
      yield* begin(service);
      yield* awaitPhase(service, "ready");
      world.server.answers = false;

      const stopped = yield* Effect.flip(service.remove({ force: false }));
      assert.isTrue(stopped.canForce);
      assert.match(stopped.message, /Could not reach the new server.*would be lost/);
      assert.strictEqual(world.hetzner.servers.size, 1);

      // Without the Hetzner key the server cannot be deleted, and it says so.
      yield* service.forgetKeys();
      const needsKey = yield* Effect.flip(service.remove({ force: true }));
      assert.match(needsKey.message, /Paste your Hetzner key again/);
      assert.strictEqual(world.hetzner.servers.size, 1);

      yield* saveKeys(service);
      const removed = yield* service.remove({ force: true });
      assert.isNull(removed.move);
      assert.deepStrictEqual(removed.removal?.problems, [
        "Notes changed on the server were not copied back to this computer.",
      ]);
      assert.strictEqual(world.hetzner.servers.size, 0);
    }).pipe(Effect.provide(computer())),
  );

  it.effect("names each thing that is not ready, with its fix", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      const world = fakeWorld();
      const { service } = yield* startService(world, vault.root, {
        tailscale: { ...signedIn, httpsServeEnabled: false },
      });
      const messages = (check: { problems: ReadonlyArray<{ area: string; message: string }> }) =>
        check.problems.map((problem) => `${problem.area}: ${problem.message}`);

      const nothing = yield* service.check({ projectId });
      assert.deepStrictEqual(messages(nothing), [
        "tailscale: HTTPS is off for your Tailscale network, so the server would have no secure address. Turn on HTTPS Certificates at https://login.tailscale.com/admin/dns.",
        "hetzner: Paste your Hetzner key.",
        "tailscale: Paste your Tailscale secret.",
      ]);
      assert.deepStrictEqual(nothing.locations, []);

      yield* saveKeys(service);
      world.hetzner.createFirewall = hetznerError(403, "forbidden");
      world.tailscale.createKey = {
        status: 400,
        body: { message: "requested tags [tag:majordome] are invalid or not permitted" },
      };
      world.tailscale.devices = [{ nodeId: "nX", name: "laptop.other.ts.net", hostname: "laptop" }];
      const wrong = messages(yield* service.check({ projectId }));
      assert.match(wrong[1] ?? "", /^hetzner: This Hetzner key can only read/);
      assert.match(wrong[2] ?? "", /^tailscale: This Tailscale credential belongs to a different/);

      world.tailscale.devices = [
        { nodeId: "nMAC", name: `macbook.${TAILNET}`, hostname: "macbook" },
      ];
      assert.match(
        messages(yield* service.check({ projectId }))[2] ?? "",
        /^tailscale: The Tailscale credential can't use the tag tag:majordome/,
      );

      world.tailscale.rejectSecret = true;
      assert.match(
        messages(yield* service.check({ projectId }))[2] ?? "",
        /^tailscale: Tailscale does not accept this secret/,
      );

      // A half-finished merge in the notes stops the copy before anything is rented.
      yield* vault.fs.writeFileString(`${vault.root}/.git/MERGE_HEAD`, "0".repeat(40));
      assert.match(
        messages(yield* service.check({ projectId }))[0] ?? "",
        /^notes: Your notes are in the middle of combining two versions/,
      );
    }).pipe(Effect.provide(computer())),
  );

  it.effect("says which key was pasted in the wrong box, and forgets keys on request", () =>
    Effect.gen(function* () {
      const vault = yield* makeVault();
      const { service } = yield* startService(fakeWorld(), vault.root);
      const wrongKind = yield* Effect.flip(service.saveKeys({ tailscaleSecret: AUTH_KEY }));
      assert.match(wrongKind.message, /This is a Tailscale auth key.*tskey-client-/);
      const swapped = yield* Effect.flip(service.saveKeys({ hetznerToken: TAILSCALE_SECRET }));
      assert.match(swapped.message, /This is a Tailscale key, not a Hetzner one/);
      assert.deepStrictEqual((yield* service.status()).keys, { hetzner: false, tailscale: false });

      assert.deepStrictEqual((yield* saveKeys(service)).keys, { hetzner: true, tailscale: true });
      assert.deepStrictEqual((yield* service.forgetKeys()).keys, {
        hetzner: false,
        tailscale: false,
      });
    }).pipe(Effect.provide(computer())),
  );

  it.effect("keeps every key, token and secret out of its status and its state file", () =>
    Effect.gen(function* () {
      const { world, service } = yield* ready();
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const seen: Array<string> = [];
      world.server.acceptsSecret = false;
      yield* begin(service);
      seen.push(JSON.stringify(yield* awaitPhase(service, "failed")));
      world.server.acceptsSecret = true;
      yield* service.retry();
      seen.push(JSON.stringify(yield* awaitPhase(service, "ready")));
      seen.push(yield* fs.readFileString(`${config.stateDir}/majordome/server-move.json`));
      world.hetzner.servers.clear();
      world.server.answers = false;
      seen.push(JSON.stringify(yield* Effect.flip(service.remove({ force: false }))));

      const setupSecret = world.http.requests
        .filter((sent) => sent.route.endsWith("/oauth/token") && sent.url.host.endsWith(TAILNET))
        .map((sent) => new URLSearchParams(sent.body).get("subject_token")!)[0]!;
      assert.match(setupSecret, /^mjsetup-/);
      for (const secret of [HETZNER_TOKEN, TAILSCALE_SECRET, AUTH_KEY, SESSION, setupSecret]) {
        for (const text of seen) assert.notInclude(text, secret);
      }
    }).pipe(Effect.provide(computer())),
  );
});
