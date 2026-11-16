/**
 * What the assistant can reach from this server: each enabled provider's connectors (MCP
 * servers), or that the provider cannot list them. Asking starts each provider's CLI, so answers
 * are kept for a minute.
 */

import type { MajordomeConnectorsResult, MajordomeProviderConnectors } from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";

const CACHE_TTL = Duration.minutes(1);

export class MajordomeConnectors extends Context.Service<
  MajordomeConnectors,
  {
    /** Never fails: a provider whose check failed carries the reason in its own entry. */
    readonly list: (input: {
      readonly refresh?: boolean | undefined;
    }) => Effect.Effect<MajordomeConnectorsResult>;
  }
>()("t3/majordome/MajordomeConnectors") {}

const readInstance = Effect.fn("MajordomeConnectors.readInstance")(function* (
  instance: ProviderInstance,
): Effect.fn.Return<MajordomeProviderConnectors> {
  const identity = {
    instanceId: instance.instanceId,
    driver: instance.driverKind,
    ...(instance.displayName === undefined ? {} : { displayName: instance.displayName }),
  };
  if (instance.listConnectors === undefined) {
    return { ...identity, reported: false, connectors: [] };
  }
  const exit = yield* Effect.exit(instance.listConnectors);
  if (Exit.isSuccess(exit)) return { ...identity, reported: true, connectors: exit.value };
  yield* Effect.logWarning("Could not list a provider's connectors.", {
    instanceId: instance.instanceId,
    cause: exit.cause,
  });
  return {
    ...identity,
    reported: true,
    error: Option.match(Exit.findErrorOption(exit), {
      onNone: () => "The connectors check stopped unexpectedly.",
      onSome: (error) => error.detail,
    }),
    connectors: [],
  };
});

const make = Effect.gen(function* () {
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;

  const readAll = Effect.fn("MajordomeConnectors.readAll")(function* (_key: "all") {
    const instances = yield* providerInstances.listInstances;
    const providers = yield* Effect.forEach(
      instances.filter((instance) => instance.enabled),
      readInstance,
      { concurrency: "unbounded" },
    );
    return { checkedAt: DateTime.formatIso(yield* DateTime.now), providers };
  });
  const cache = yield* Cache.make({ capacity: 1, timeToLive: CACHE_TTL, lookup: readAll });

  const list: MajordomeConnectors["Service"]["list"] = Effect.fn("MajordomeConnectors.list")(
    function* (input) {
      if (input.refresh === true) yield* Cache.invalidateAll(cache);
      return yield* Cache.get(cache, "all");
    },
  );

  return MajordomeConnectors.of({ list });
});

export const layer = Layer.effect(MajordomeConnectors, make);
