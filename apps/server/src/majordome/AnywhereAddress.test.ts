import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { MajordomeAnywhere, ManagedPolicyDocument } from "@t3tools/contracts";
import type { RelayManagedEndpointRuntimeConfig } from "@t3tools/contracts/relay";
import * as RelayClient from "@t3tools/shared/relayClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";
import * as TestClock from "effect/testing/TestClock";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Checks the proof the way the address service does, outside Effect.
import * as NodeCrypto from "node:crypto";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as EnvironmentKeys from "../cloud/environmentKeys.ts";
import * as ManagedEndpointRuntime from "../cloud/ManagedEndpointRuntime.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as AnywhereAddress from "./AnywhereAddress.ts";
import { fakeHttp, type FakeReply, type SentRequest } from "./fakeHttp.testkit.ts";

const ADDRESS_SECRET = "majordome-anywhere-address";
const PORT = 3774;

const address = (token: string) => ({
  hostname: "quiet-otter.majord.link",
  url: "https://quiet-otter.majord.link",
  tunnelId: "tunnel-1",
  connectorToken: token,
});

const connectorConfig = (token: string): RelayManagedEndpointRuntimeConfig => ({
  providerKind: "cloudflare_tunnel",
  connectorToken: token,
  tunnelId: "tunnel-1",
  tunnelName: "quiet-otter.majord.link",
});

const running: ManagedEndpointRuntime.CloudManagedEndpointRuntimeStatus = {
  status: "running",
  providerKind: "cloudflare_tunnel",
  pid: 42,
};

const failed = (
  failure: "unsupported-platform" | "not-installed",
): ManagedEndpointRuntime.CloudManagedEndpointRuntimeStatus => ({
  status: "failed",
  providerKind: "cloudflare_tunnel",
  failure,
  reason: "test",
});

interface WorldOptions {
  readonly stored?: ReturnType<typeof address>;
  readonly policy?: ManagedPolicyDocument;
  readonly reply?: (sent: SentRequest) => FakeReply;
  readonly status?: ManagedEndpointRuntime.CloudManagedEndpointRuntimeStatus;
  readonly readyConnections?: number;
}

/** One computer: its secrets, a connector runtime that records what it is told, and the service. */
const makeWorld = Effect.fn("makeWorld")(function* (options: WorldOptions = {}) {
  const secrets = new Map<string, Uint8Array>();
  if (options.stored !== undefined) {
    secrets.set(ADDRESS_SECRET, new TextEncoder().encode(JSON.stringify(options.stored)));
  }
  const applied = yield* Queue.unbounded<RelayManagedEndpointRuntimeConfig | null>();
  const lock = yield* Semaphore.make(1);
  const http = fakeHttp(options.reply ?? (() => ({ body: address("token-1") })));
  const status = options.status ?? running;
  let connectorRunning = false;
  let installs = 0;

  const layerSecrets = Layer.mock(ServerSecretStore.ServerSecretStore)({
    get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
    set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
    create: (name, value) => Effect.sync(() => void secrets.set(name, value)),
    remove: (name) => Effect.sync(() => void secrets.delete(name)),
  });
  const layerRuntime = Layer.mock(ManagedEndpointRuntime.CloudManagedEndpointRuntime)({
    applyConfig: (config) =>
      Effect.gen(function* () {
        connectorRunning = config !== null && status.status === "running";
        yield* Queue.offer(applied, config);
        return config === null ? { status: "disabled" as const } : status;
      }),
    inspectConnector: Effect.sync(() =>
      connectorRunning
        ? {
            pid: 42,
            readyConnections: options.readyConnections ?? 1,
            hostname: null,
            origin: null,
            protocol: null,
          }
        : null,
    ),
    withLinkStateLock: lock.withPermits(1),
  });
  const available = {
    status: "available" as const,
    executablePath: "/test/cloudflared",
    source: "managed" as const,
    version: RelayClient.CLOUDFLARED_VERSION,
  };
  const layerRelayClient = Layer.mock(RelayClient.RelayClient)({
    resolve: Effect.sync(() =>
      installs > 0 ? available : { status: "missing" as const, version: available.version },
    ),
    install: Effect.sync(() => {
      installs += 1;
      return available;
    }),
  });
  const layerConfig = Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      return ServerConfig.make({ ...(yield* ServerConfig.ServerConfig), port: PORT });
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-anywhere-" })));

  const layer = AnywhereAddress.layer.pipe(
    Layer.provideMerge(EnvironmentKeys.layer),
    Layer.provide(
      Layer.mergeAll(
        layerSecrets,
        layerRuntime,
        layerRelayClient,
        layerConfig,
        ManagedPolicy.layerTest(options.policy),
        Layer.succeed(HttpClient.HttpClient, http.client),
      ),
    ),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCryptoLayer.layer)),
  );

  return {
    layer,
    secrets,
    requests: http.requests,
    installs: () => installs,
    nextApplied: Queue.take(applied),
    appliedCount: Queue.size(applied),
    /** Waits for whoever holds the runtime's lock, such as the start-up re-apply, to finish. */
    settled: lock.withPermits(1)(Effect.void),
    started: Queue.take(applied).pipe(Effect.andThen(lock.withPermits(1)(Effect.void))),
    storedAddress: () => {
      const bytes = secrets.get(ADDRESS_SECRET);
      return bytes === undefined ? null : JSON.parse(new TextDecoder().decode(bytes));
    },
  };
});

const decodePart = (part: string | undefined) =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));

const decodeBody = Schema.decodeUnknownSync(
  Schema.Struct({ publicKey: Schema.String, proof: Schema.String }),
);

const readProof = (sent: SentRequest | undefined) => {
  const { publicKey, proof } = decodeBody(sent?.json);
  const [header, payload, signature] = proof.split(".");
  return {
    publicKey,
    header: decodePart(header),
    claims: decodePart(payload),
    verified: NodeCrypto.verify(
      null,
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature ?? "", "base64url"),
    ),
  };
};

describe("AnywhereAddress", () => {
  it.effect("enable asks for an address, stores it, starts the connector and reports ready", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld();
      yield* Effect.gen(function* () {
        const anywhere = yield* AnywhereAddress.AnywhereAddress;
        const signingKey = yield* EnvironmentKeys.EnvironmentSigningKey;
        assert.deepStrictEqual(yield* anywhere.read(), { state: "off", url: null, reason: null });

        assert.deepStrictEqual(yield* anywhere.enable(), {
          state: "ready",
          url: "https://quiet-otter.majord.link",
          reason: null,
        });

        assert.strictEqual(world.installs(), 1);
        assert.deepStrictEqual(
          world.requests.map((sent) => sent.route),
          ["POST broker.majord.link/v1/address"],
        );
        assert.deepStrictEqual(readProof(world.requests[0]), {
          publicKey: signingKey.publicKey,
          header: { alg: "EdDSA", typ: "majord-address+jwt" },
          claims: { aud: "majord-broker", act: "claim", port: PORT, iat: 0, exp: 120 },
          verified: true,
        });
        assert.deepStrictEqual(world.storedAddress(), address("token-1"));
        assert.deepStrictEqual(yield* world.nextApplied, connectorConfig("token-1"));
      }).pipe(Effect.provide(world.layer));
    }),
  );

  it.effect("enable reports starting when the connector has not connected after 30 seconds", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld({ readyConnections: 0 });
      yield* Effect.gen(function* () {
        const anywhere = yield* AnywhereAddress.AnywhereAddress;
        const enabling = yield* Effect.forkChild(anywhere.enable());
        yield* world.nextApplied;
        yield* TestClock.adjust(Duration.seconds(29));
        assert.isUndefined(enabling.pollUnsafe());
        yield* TestClock.adjust(Duration.seconds(1));
        assert.deepStrictEqual(yield* Fiber.join(enabling), {
          state: "starting",
          url: "https://quiet-otter.majord.link",
          reason: null,
        });
      }).pipe(Effect.provide(world.layer));
    }),
  );

  it.effect.each([
    {
      error: "rate_limited",
      status: 429,
      message: "Too many new addresses were asked for from this network today. Try again tomorrow.",
    },
    { error: "full", status: 503, message: "No more addresses are available right now." },
    { error: "blocked", status: 403, message: "This computer's address was turned off." },
    { error: "upstream", status: 502, message: "Could not get an address." },
  ])("enable stores nothing when the address service says $error", (row) =>
    Effect.gen(function* () {
      const world = yield* makeWorld({
        reply: () => ({ status: row.status, body: { error: row.error, message: "ignored" } }),
      });
      yield* Effect.gen(function* () {
        const anywhere = yield* AnywhereAddress.AnywhereAddress;
        const error = yield* Effect.flip(anywhere.enable());
        assert.strictEqual(error.message, row.message);
        assert.isNull(world.storedAddress());
        assert.strictEqual(yield* world.appliedCount, 0);
        assert.deepStrictEqual(yield* anywhere.read(), { state: "off", url: null, reason: null });
      }).pipe(Effect.provide(world.layer));
    }),
  );

  it.effect.each<{
    readonly name: string;
    readonly limits: NonNullable<ManagedPolicyDocument["limits"]>;
  }>([
    { name: "remote devices", limits: { clients: ["desktop"] } },
    { name: "the connector", limits: { connect: false } },
  ])("enable is refused when the organization's policy rules out $name", (row) =>
    Effect.gen(function* () {
      const world = yield* makeWorld({
        policy: { schemaVersion: 1, organization: "Example Corp", limits: row.limits },
      });
      yield* Effect.gen(function* () {
        const anywhere = yield* AnywhereAddress.AnywhereAddress;
        const error = yield* Effect.flip(anywhere.enable());
        assert.match(error.message, /^Your organization doesn't allow /);
        assert.deepStrictEqual(world.requests, []);
        assert.strictEqual(world.installs(), 0);
        assert.strictEqual(yield* world.appliedCount, 0);
      }).pipe(Effect.provide(world.layer));
    }),
  );

  it.effect("disable stops the connector and forgets the address, keeping it at the service", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld({ stored: address("token-1") });
      yield* Effect.gen(function* () {
        const anywhere = yield* AnywhereAddress.AnywhereAddress;
        yield* world.started;

        assert.deepStrictEqual(yield* anywhere.disable(), {
          state: "off",
          url: null,
          reason: null,
        });

        assert.isNull(yield* world.nextApplied);
        assert.isNull(world.storedAddress());
        assert.deepStrictEqual(world.requests, []);
        assert.deepStrictEqual(yield* anywhere.read(), { state: "off", url: null, reason: null });
      }).pipe(Effect.provide(world.layer));
    }),
  );

  const url = "https://quiet-otter.majord.link";
  it.effect.each<{
    readonly name: string;
    readonly world: WorldOptions;
    readonly expected: Pick<MajordomeAnywhere, "state" | "reason">;
  }>([
    {
      name: "a connected connector",
      world: { readyConnections: 2 },
      expected: { state: "ready", reason: null },
    },
    {
      name: "a connector still connecting",
      world: { readyConnections: 0 },
      expected: { state: "starting", reason: null },
    },
    {
      name: "a computer the connector does not support",
      world: { status: failed("unsupported-platform") },
      expected: { state: "unavailable", reason: "This kind of computer cannot have an address." },
    },
    {
      name: "a connector that could not be downloaded",
      world: { status: failed("not-installed") },
      expected: {
        state: "unavailable",
        reason:
          "Could not download what the address needs. Check this computer's internet connection.",
      },
    },
  ])("a restart brings a stored address back, and read reports $name", (row) =>
    Effect.gen(function* () {
      const world = yield* makeWorld({ ...row.world, stored: address("token-1") });
      yield* Effect.gen(function* () {
        const anywhere = yield* AnywhereAddress.AnywhereAddress;
        assert.deepStrictEqual(yield* world.nextApplied, connectorConfig("token-1"));
        yield* world.settled;
        assert.deepStrictEqual(yield* anywhere.read(), { ...row.expected, url });
        assert.deepStrictEqual(world.requests, []);
      }).pipe(Effect.provide(world.layer));
    }),
  );

  it.effect("recovery asks for the address again and moves the connector to the new token", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld({
        stored: address("token-1"),
        reply: () => ({ body: address("token-2") }),
      });
      yield* Effect.gen(function* () {
        const anywhere = yield* AnywhereAddress.AnywhereAddress;
        yield* world.started;

        assert.isFalse(yield* anywhere.recover(connectorConfig("someone-else")));
        assert.deepStrictEqual(world.requests, []);

        assert.isTrue(yield* anywhere.recover(connectorConfig("token-1")));
        assert.strictEqual(readProof(world.requests[0]).claims.act, "claim");
        assert.deepStrictEqual(world.storedAddress(), address("token-2"));
        assert.deepStrictEqual(yield* world.nextApplied, connectorConfig("token-2"));
      }).pipe(Effect.provide(world.layer));
    }),
  );

  it.effect("a failed recovery keeps the address and lets read say why", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld({
        stored: address("token-1"),
        readyConnections: 0,
        reply: () => ({ status: 403, body: { error: "blocked", message: "ignored" } }),
      });
      yield* Effect.gen(function* () {
        const anywhere = yield* AnywhereAddress.AnywhereAddress;
        yield* world.started;

        assert.isTrue(yield* anywhere.recover(connectorConfig("token-1")));

        assert.deepStrictEqual(world.storedAddress(), address("token-1"));
        assert.strictEqual(yield* world.appliedCount, 0);
        assert.deepStrictEqual(yield* anywhere.read(), {
          state: "unavailable",
          url,
          reason: "This computer's address was turned off.",
        });
      }).pipe(Effect.provide(world.layer));
    }),
  );
});
