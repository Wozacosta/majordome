/**
 * What a phone needs to reach this computer. iPhone notifications only work for a Home Screen web
 * app opened over HTTPS, so Majordome guides the owner to Tailscale's secure (`*.ts.net`) address,
 * with plain Wi-Fi as a fallback that cannot notify.
 */

import {
  MajordomePhoneError,
  type MajordomePhoneSetup,
  type MajordomeTailscaleState,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { formatHostForUrl, isWildcardHost } from "@t3tools/shared/hostClassification";
import {
  buildTailscaleHttpsBaseUrl,
  ensureTailscaleServe,
  probeTailscaleHttpsEndpoint,
  readTailscaleServeRootHolder,
  readTailscaleStatus,
  type TailscaleStatus,
} from "@t3tools/tailscale";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as DirectEndpoints from "../environment/DirectEndpoints.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ManagedLimits from "../policy/managedLimits.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { isLoopbackHost } from "../startupAccess.ts";
import * as AnywhereAddress from "./AnywhereAddress.ts";

/** The local address Tailscale Serve forwards to: in development, the web dev server. */
export function secureAddressTarget(config: {
  readonly devUrl: URL | undefined;
  readonly host: string | undefined;
  readonly port: number;
}): { readonly host: string; readonly port: number; readonly urlHost?: string } {
  if (config.devUrl !== undefined) {
    const port = config.devUrl.port === "" ? 80 : Number.parseInt(config.devUrl.port, 10);
    // The dev server may listen on IPv6 only, so forward to the name it was started with.
    return isLoopbackHost(config.devUrl.hostname)
      ? { host: config.devUrl.hostname, port }
      : { host: config.devUrl.hostname, port, urlHost: config.devUrl.hostname };
  }
  if (config.host !== undefined && !isWildcardHost(config.host) && !isLoopbackHost(config.host)) {
    const urlHost = formatHostForUrl(config.host);
    return { host: config.host, port: config.port, urlHost };
  }
  return { host: "127.0.0.1", port: config.port };
}

/** Where Tailscale stands, before asking whether this server answers on its secure address. */
export function tailscaleStateFromStatus(
  status: TailscaleStatus | "not-installed" | "unreadable",
): Exclude<MajordomeTailscaleState, "ready" | "not-served"> | "maybe-served" {
  if (status === "not-installed") return "not-installed";
  if (status === "unreadable") return "signed-out";
  if (status.running === false || status.magicDnsName === null) return "signed-out";
  if (status.httpsServeEnabled === false) return "https-off";
  return "maybe-served";
}

export class PhoneSetup extends Context.Service<
  PhoneSetup,
  {
    readonly read: () => Effect.Effect<MajordomePhoneSetup, MajordomePhoneError>;
    /** Runs `tailscale serve` for this server. Only from the owner's explicit confirmation. */
    readonly enableSecureAddress: () => Effect.Effect<MajordomePhoneSetup, MajordomePhoneError>;
    /** Opens the public address. Only from the owner's explicit confirmation. */
    readonly enableAnywhereAddress: () => Effect.Effect<MajordomePhoneSetup, MajordomePhoneError>;
    readonly disableAnywhereAddress: () => Effect.Effect<MajordomePhoneSetup, MajordomePhoneError>;
  }
>()("t3/majordome/PhoneSetup") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const directEndpoints = yield* DirectEndpoints.DirectEndpoints;
  const policy = yield* ManagedPolicy.ManagedPolicy;
  const anywhereAddress = yield* AnywhereAddress.AnywhereAddress;
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;
  const services = yield* Effect.context<
    ChildProcessSpawner.ChildProcessSpawner | HttpClient.HttpClient | NetService.NetService
  >();
  const target = secureAddressTarget(config);

  const readStatus = readTailscaleStatus.pipe(
    Effect.map((status): TailscaleStatus | "not-installed" | "unreadable" => status),
    Effect.catchTags({
      TailscaleCommandSpawnError: () => Effect.succeed("not-installed" as const),
    }),
    Effect.orElseSucceed(() => "unreadable" as const),
  );

  const read = Effect.fn("PhoneSetup.read")(
    function* () {
      const anywhere = yield* anywhereAddress.read();
      const status = yield* readStatus;
      const wifiUrls = (yield* directEndpoints.resolveAvailable())
        .filter((endpoint) => endpoint.kind === "lan")
        .map((endpoint) => endpoint.httpBaseUrl);
      const secureUrl =
        typeof status === "object" && status.magicDnsName !== null
          ? buildTailscaleHttpsBaseUrl({
              magicDnsName: status.magicDnsName,
              servePort: config.tailscaleServePort,
            })
          : null;
      const state = tailscaleStateFromStatus(status);
      if (state !== "maybe-served" || secureUrl === null) {
        return {
          anywhere,
          tailscale: state === "maybe-served" ? "signed-out" : state,
          secureUrl,
          wifiUrls,
        };
      }
      // A computer cannot always reach its own MagicDNS name, so a route that Serve says is ours
      // counts too.
      const answers = yield* probeTailscaleHttpsEndpoint({ baseUrl: secureUrl, environmentId });
      const holder = answers
        ? ("ours" as const)
        : yield* readTailscaleServeRootHolder(config.tailscaleServePort, target).pipe(
            Effect.orElseSucceed(() => "unreadable" as const),
          );
      return {
        anywhere,
        tailscale: holder === "ours" ? ("ready" as const) : ("not-served" as const),
        secureUrl,
        wifiUrls,
      };
    },
    (effect) => effect.pipe(Effect.provide(services)),
  );

  const enableSecureAddress = Effect.fn("PhoneSetup.enableSecureAddress")(
    function* () {
      if (!ManagedLimits.allowsRemoteClients(policy)) {
        return yield* new MajordomePhoneError({
          message: "Your organization doesn't allow other devices to connect to this computer.",
        });
      }
      const status = yield* readStatus;
      const state = tailscaleStateFromStatus(status);
      if (state !== "maybe-served") {
        return yield* new MajordomePhoneError({
          message:
            state === "https-off"
              ? "Turn on HTTPS for your Tailscale network first."
              : "Tailscale needs to be installed and signed in on this computer first.",
        });
      }
      const holder = yield* readTailscaleServeRootHolder(config.tailscaleServePort, target).pipe(
        Effect.mapError(
          (cause) =>
            new MajordomePhoneError({ message: "Could not read Tailscale's setup.", cause }),
        ),
      );
      if (holder === "other") {
        return yield* new MajordomePhoneError({
          message:
            "Another app already uses this computer's secure Tailscale address, so Majordome left it alone.",
        });
      }
      if (holder !== "ours") {
        yield* ensureTailscaleServe({
          localPort: target.port,
          servePort: config.tailscaleServePort,
          ...(target.urlHost === undefined ? {} : { localHost: target.urlHost }),
        }).pipe(
          Effect.mapError(
            (cause) =>
              new MajordomePhoneError({
                message:
                  cause._tag === "TailscaleServeHttpsDisabledError"
                    ? "Turn on HTTPS for your Tailscale network first."
                    : "Tailscale could not set up the secure address.",
                cause,
              }),
          ),
        );
        yield* Effect.logInfo("Majordome turned on Tailscale Serve for this server.", {
          servePort: config.tailscaleServePort,
          localPort: target.port,
        });
      }
      return yield* read();
    },
    (effect) => effect.pipe(Effect.provide(services)),
  );

  const enableAnywhereAddress = Effect.fn("PhoneSetup.enableAnywhereAddress")(function* () {
    yield* anywhereAddress.enable();
    return yield* read();
  });

  const disableAnywhereAddress = Effect.fn("PhoneSetup.disableAnywhereAddress")(function* () {
    yield* anywhereAddress.disable();
    return yield* read();
  });

  return PhoneSetup.of({
    read,
    enableSecureAddress,
    enableAnywhereAddress,
    disableAnywhereAddress,
  });
});

export const layer = Layer.effect(PhoneSetup, make);
