/**
 * This computer's public `*.majord.link` address, which a phone reaches with nothing installed.
 * The address service hands out the address and a Cloudflare Tunnel connector token; the connector
 * runtime built for T3 Connect runs it. Nothing here goes through T3 Connect's accounts.
 */

import { MajordomePhoneError, type MajordomeAnywhere } from "@t3tools/contracts";
import type { RelayManagedEndpointRuntimeConfig } from "@t3tools/contracts/relay";
import { isWildcardHost } from "@t3tools/shared/hostClassification";
import * as RelayClient from "@t3tools/shared/relayClient";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as EnvironmentKeys from "../cloud/environmentKeys.ts";
import * as ManagedEndpointRuntime from "../cloud/ManagedEndpointRuntime.ts";
import { makeManagedTunnelRecovery } from "../cloud/managedTunnelStartup.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedLimits from "../policy/managedLimits.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerActivation from "../serverActivation.ts";
import { isLoopbackHost } from "../startupAccess.ts";

const ADDRESS_SERVICE_URL_VARIABLE = "MAJORDOME_ADDRESS_SERVICE_URL";
const DEFAULT_ADDRESS_SERVICE_URL = "https://broker.majord.link";
const ADDRESS_SECRET = "majordome-anywhere-address";
const PROOF_TYP = "majord-address+jwt";
const PROOF_AUDIENCE = "majord-broker";
const PROOF_LIFETIME_SECONDS = 120;
const REQUEST_TIMEOUT = Duration.seconds(20);
const CONNECT_WAIT_SECONDS = 30;

const REMOTE_CLIENTS_REFUSED =
  "Your organization doesn't allow other devices to connect to this computer.";
const ADDRESS_REFUSED =
  "Your organization doesn't allow this computer to have an address outside your network.";
const UNSUPPORTED_COMPUTER = "This kind of computer cannot have an address.";
const DOWNLOAD_FAILED =
  "Could not download what the address needs. Check this computer's internet connection.";

const StoredAddress = Schema.Struct({
  hostname: Schema.String,
  url: Schema.String,
  tunnelId: Schema.String,
  connectorToken: Schema.String,
});
type StoredAddress = typeof StoredAddress.Type;
const StoredAddressJson = Schema.fromJsonString(StoredAddress);
const decodeStoredAddress = Schema.decodeUnknownOption(StoredAddressJson);
const encodeStoredAddress = Schema.encodeSync(StoredAddressJson);
const decodeClaimedAddress = Schema.decodeUnknownOption(
  Schema.Struct({
    hostname: Schema.NonEmptyString,
    url: Schema.NonEmptyString,
    tunnelId: Schema.NonEmptyString,
    connectorToken: Schema.NonEmptyString,
  }),
);

const AddressServiceErrorReason = Schema.Literals([
  "rate_limited",
  "full",
  "blocked",
  "unreachable",
  "failed",
]);
type AddressServiceErrorReason = typeof AddressServiceErrorReason.Type;
const decodeErrorBody = Schema.decodeUnknownOption(Schema.Struct({ error: Schema.String }));

const REASON_MESSAGES: Record<AddressServiceErrorReason, string> = {
  rate_limited:
    "Too many new addresses were asked for from this network today. Try again tomorrow.",
  full: "No more addresses are available right now.",
  blocked: "This computer's address was turned off.",
  unreachable: "Could not reach the address service. Check this computer's internet connection.",
  failed: "Could not get an address.",
};

/** There is no `cause`: the request holds the proof and the answer holds the connector token. */
class AddressServiceError extends Schema.TaggedError<AddressServiceError>()("AddressServiceError", {
  reason: AddressServiceErrorReason,
  status: Schema.optional(Schema.Number),
}) {
  override get message(): string {
    return REASON_MESSAGES[this.reason];
  }
}

const ownerError = (cause: AddressServiceError) =>
  new MajordomePhoneError({ message: cause.message, cause });

const runtimeConfigFor = (address: StoredAddress): RelayManagedEndpointRuntimeConfig => ({
  providerKind: "cloudflare_tunnel",
  connectorToken: address.connectorToken,
  tunnelId: address.tunnelId,
  tunnelName: address.hostname,
});

/** Why the address does not work. `connectorDown` problems end once a connector runs again. */
interface Problem {
  readonly reason: string;
  readonly connectorDown: boolean;
}

function problemFromStatus(
  status: ManagedEndpointRuntime.CloudManagedEndpointRuntimeStatus,
): Problem | null {
  switch (status.status) {
    case "running":
      return null;
    case "disabled":
      return { reason: ADDRESS_REFUSED, connectorDown: true };
    case "unsupported":
      return { reason: UNSUPPORTED_COMPUTER, connectorDown: true };
    case "failed":
      return {
        reason:
          status.failure === "unsupported-platform"
            ? UNSUPPORTED_COMPUTER
            : status.failure === "not-installed"
              ? DOWNLOAD_FAILED
              : "The address could not be started on this computer.",
        connectorDown: true,
      };
  }
}

export class AnywhereAddress extends Context.Service<
  AnywhereAddress,
  {
    readonly read: () => Effect.Effect<MajordomeAnywhere, MajordomePhoneError>;
    /** Puts this computer on the public internet. Only from the owner's explicit confirmation. */
    readonly enable: () => Effect.Effect<MajordomeAnywhere, MajordomePhoneError>;
    readonly disable: () => Effect.Effect<MajordomeAnywhere, MajordomePhoneError>;
    /**
     * Asks for the address again when the connector that wants recovery carries it. `false`
     * means the connector is not this service's, so T3 Connect should handle the request.
     */
    readonly recover: (config: RelayManagedEndpointRuntimeConfig) => Effect.Effect<boolean>;
  }
>()("t3/majordome/AnywhereAddress") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const policy = yield* ManagedPolicy.ManagedPolicy;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const signingKey = yield* EnvironmentKeys.EnvironmentSigningKey;
  const runtime = yield* ManagedEndpointRuntime.CloudManagedEndpointRuntime;
  const relayClient = yield* RelayClient.RelayClient;
  const http = yield* HttpClient.HttpClient;
  const serviceUrl = (yield* Config.String(ADDRESS_SERVICE_URL_VARIABLE).pipe(
    Config.withDefault(DEFAULT_ADDRESS_SERVICE_URL),
    Effect.orElseSucceed(() => DEFAULT_ADDRESS_SERVICE_URL),
  )).replace(/\/+$/u, "");
  // The connector forwards to this port on loopback, so the server has to answer there.
  const answersOnLoopback =
    config.host === undefined || isWildcardHost(config.host) || isLoopbackHost(config.host);
  const problemRef = yield* Ref.make<Problem | null>(null);
  const serviceScope = yield* Effect.scope;

  const readStored = secrets.get(ADDRESS_SECRET).pipe(
    Effect.map(Option.flatMap((bytes) => decodeStoredAddress(new TextDecoder().decode(bytes)))),
    Effect.mapError(
      (cause) =>
        new MajordomePhoneError({ message: "Could not read this computer's address.", cause }),
    ),
  );

  const askService = Effect.fn("AnywhereAddress.askService")(function* () {
    const issuedAt = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
    const proof = yield* signingKey
      .sign({
        typ: PROOF_TYP,
        payload: {
          aud: PROOF_AUDIENCE,
          act: "claim",
          port: config.port,
          iat: issuedAt,
          exp: issuedAt + PROOF_LIFETIME_SECONDS,
        },
      })
      .pipe(Effect.mapError(() => new AddressServiceError({ reason: "failed" })));
    const response = yield* HttpClientRequest.post(`${serviceUrl}/v1/address`).pipe(
      HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "majordome" }),
      HttpClientRequest.bodyJsonUnsafe({ publicKey: signingKey.publicKey, proof }),
      http.execute,
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError(() => new AddressServiceError({ reason: "unreachable" })),
    );
    const json: unknown = yield* response.json.pipe(Effect.orElseSucceed(() => null));
    if (response.status >= 200 && response.status < 300) return json;
    const code = Option.getOrUndefined(decodeErrorBody(json))?.error;
    return yield* new AddressServiceError({
      reason: code === "rate_limited" || code === "full" || code === "blocked" ? code : "failed",
      status: response.status,
    });
  });

  const claim = Effect.fn("AnywhereAddress.claim")(function* () {
    const claimed = decodeClaimedAddress(yield* askService());
    if (Option.isNone(claimed)) return yield* new AddressServiceError({ reason: "failed" });
    return claimed.value;
  });

  const store = (address: StoredAddress) =>
    secrets.set(ADDRESS_SECRET, new TextEncoder().encode(encodeStoredAddress(address)));

  const apply = Effect.fn("AnywhereAddress.apply")(function* (address: StoredAddress) {
    const status = yield* runtime.applyConfig(runtimeConfigFor(address));
    yield* Ref.set(problemRef, problemFromStatus(status));
    return status;
  });

  const isConnected = runtime.inspectConnector.pipe(
    Effect.map((connector) => (connector?.readyConnections ?? 0) > 0),
  );

  // The runtime's connection events each have another reader, so this asks the connector itself.
  const waitUntilConnected = Effect.gen(function* () {
    for (let second = 0; second < CONNECT_WAIT_SECONDS; second++) {
      if (yield* isConnected) return;
      yield* Effect.sleep(Duration.seconds(1));
    }
  });

  const read = Effect.fn("AnywhereAddress.read")(function* () {
    const stored = yield* readStored;
    if (Option.isNone(stored)) return { state: "off" as const, url: null, reason: null };
    const { url } = stored.value;
    const connector = yield* runtime.inspectConnector;
    if ((connector?.readyConnections ?? 0) > 0) {
      return { state: "ready" as const, url, reason: null };
    }
    const problem = yield* Ref.get(problemRef);
    return problem !== null && (connector === null || !problem.connectorDown)
      ? { state: "unavailable" as const, url, reason: problem.reason }
      : { state: "starting" as const, url, reason: null };
  });

  const enable = Effect.fn("AnywhereAddress.enable")(function* () {
    if (!ManagedLimits.allowsRemoteClients(policy)) {
      return yield* new MajordomePhoneError({ message: REMOTE_CLIENTS_REFUSED });
    }
    if (!ManagedLimits.allowsConnect(policy)) {
      return yield* new MajordomePhoneError({ message: ADDRESS_REFUSED });
    }
    // In development this port redirects browsers to the web dev server, which must stay private.
    if (config.devUrl !== undefined) {
      return yield* new MajordomePhoneError({
        message: "This computer cannot have an address while Majordome runs in development.",
      });
    }
    if (!answersOnLoopback) {
      return yield* new MajordomePhoneError({
        message: "This computer only answers on one of its networks, so it cannot have an address.",
      });
    }
    const status = yield* runtime.withLinkStateLock(
      Effect.gen(function* () {
        if ((yield* relayClient.resolve).status !== "available") {
          yield* relayClient.install.pipe(
            Effect.mapError(
              (cause) =>
                new MajordomePhoneError({
                  message:
                    cause.reason === "managed_by_policy"
                      ? ADDRESS_REFUSED
                      : cause.reason === "unsupported_platform"
                        ? UNSUPPORTED_COMPUTER
                        : DOWNLOAD_FAILED,
                  cause,
                }),
            ),
          );
        }
        const address = yield* claim().pipe(Effect.mapError(ownerError));
        yield* store(address).pipe(
          Effect.mapError(
            (cause) =>
              new MajordomePhoneError({
                message: "Could not save this computer's address.",
                cause,
              }),
          ),
        );
        yield* Effect.logInfo("Majordome got a public address for this server.", {
          hostname: address.hostname,
          localPort: config.port,
        });
        return yield* apply(address);
      }),
    );
    if (status.status === "running") yield* waitUntilConnected;
    return yield* read();
  });

  // The address service keeps the address for two weeks, so turning it on again gives the same one.
  const disable = Effect.fn("AnywhereAddress.disable")(function* () {
    yield* runtime.withLinkStateLock(
      secrets.remove(ADDRESS_SECRET).pipe(
        Effect.mapError(
          (cause) =>
            new MajordomePhoneError({
              message: "Could not forget this computer's address.",
              cause,
            }),
        ),
      ),
    );
    yield* Ref.set(problemRef, null);
    // A connector with a phone connected takes up to half a minute to stop; the owner does not wait.
    yield* Effect.forkIn(runtime.applyConfig(null), serviceScope);
    return { state: "off" as const, url: null, reason: null };
  });

  const storedFor = (connector: RelayManagedEndpointRuntimeConfig) =>
    readStored.pipe(
      Effect.map(Option.filter((stored) => stored.connectorToken === connector.connectorToken)),
      Effect.orElseSucceed(() => Option.none<StoredAddress>()),
    );

  // One failure is enough: the connector asks again later, and `read` shows the reason meanwhile.
  const claimAgain = Effect.fn("AnywhereAddress.claimAgain")(function* (
    connector: RelayManagedEndpointRuntimeConfig,
  ) {
    yield* runtime.withLinkStateLock(
      Effect.gen(function* () {
        if (Option.isNone(yield* storedFor(connector))) return;
        const address = yield* claim();
        yield* store(address);
        yield* apply(address);
        yield* Effect.logInfo("Majordome renewed this server's public address.");
      }).pipe(
        Effect.catch((cause) =>
          Ref.set(problemRef, {
            reason:
              cause._tag === "AddressServiceError"
                ? cause.message
                : "Could not save this computer's address.",
            connectorDown: false,
          }).pipe(
            Effect.andThen(
              Effect.logWarning("Could not renew this server's public address.", {
                reason: cause._tag === "AddressServiceError" ? cause.reason : cause._tag,
              }),
            ),
          ),
        ),
      ),
    );
  });
  // A connector that fails for a local reason asks over and over; this spaces the requests out.
  const claimAgainSpaced = yield* makeManagedTunnelRecovery({
    recover: claimAgain,
    isRetryable: () => false,
  });

  const recover = Effect.fn("AnywhereAddress.recover")(function* (
    connector: RelayManagedEndpointRuntimeConfig,
  ) {
    if (Option.isNone(yield* storedFor(connector))) return false;
    yield* claimAgainSpaced(connector);
    return true;
  });

  yield* ServerActivation.forkParked(
    runtime
      .withLinkStateLock(
        Effect.gen(function* () {
          const stored = yield* readStored;
          if (Option.isSome(stored)) yield* apply(stored.value);
        }),
      )
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not bring this server's public address back.", { cause }),
        ),
      ),
  );

  return AnywhereAddress.of({ read, enable, disable, recover });
});

export const layer = Layer.effect(AnywhereAddress, make);
