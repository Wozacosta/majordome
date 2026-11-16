import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { ProviderDriverError } from "../provider/Errors.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as MajordomeConnectors from "./MajordomeConnectors.ts";

const instance = (
  id: string,
  fields: Pick<ProviderInstance, "listConnectors"> & {
    readonly enabled?: boolean;
    readonly displayName?: string;
  },
) =>
  ({
    instanceId: ProviderInstanceId.make(id),
    driverKind: ProviderDriverKind.make(id),
    displayName: fields.displayName,
    enabled: fields.enabled ?? true,
    ...(fields.listConnectors === undefined ? {} : { listConnectors: fields.listConnectors }),
  }) as ProviderInstance;

const gmail = { name: "claude.ai Gmail", status: "connected" } as const;

const withInstances = (instances: ReadonlyArray<ProviderInstance>) =>
  Effect.provide(
    MajordomeConnectors.layer.pipe(
      Layer.provide(
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          listInstances: Effect.succeed(instances),
        }),
      ),
    ),
  );

it.effect("lists each enabled provider's connectors, and the ones it cannot read", () => {
  const failing = ProviderInstanceId.make("claude-work");
  return Effect.gen(function* () {
    const connectors = yield* MajordomeConnectors.MajordomeConnectors;
    const result = yield* connectors.list({});
    assert.deepEqual(result.providers, [
      {
        instanceId: ProviderInstanceId.make("claude"),
        driver: ProviderDriverKind.make("claude"),
        displayName: "Claude",
        reported: true,
        connectors: [gmail],
      },
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        reported: false,
        connectors: [],
      },
      {
        instanceId: failing,
        driver: ProviderDriverKind.make("claude-work"),
        reported: true,
        error: "Claude could not list its connectors.",
        connectors: [],
      },
      {
        instanceId: ProviderInstanceId.make("broken"),
        driver: ProviderDriverKind.make("broken"),
        reported: true,
        error: "The connectors check stopped unexpectedly.",
        connectors: [],
      },
    ]);
  }).pipe(
    withInstances([
      instance("claude", { displayName: "Claude", listConnectors: Effect.succeed([gmail]) }),
      instance("codex", {}),
      instance("claude-work", {
        listConnectors: Effect.fail(
          new ProviderDriverError({
            driver: ProviderDriverKind.make("claude-work"),
            instanceId: failing,
            detail: "Claude could not list its connectors.",
          }),
        ),
      }),
      instance("broken", { listConnectors: Effect.die("boom") }),
      instance("off", { enabled: false, listConnectors: Effect.die("never asked") }),
    ]),
  );
});

it.effect("asks the providers again only after a minute or when told to", () => {
  let asked = 0;
  const counted = Effect.sync(() => {
    asked += 1;
    return [gmail];
  });
  return Effect.gen(function* () {
    const connectors = yield* MajordomeConnectors.MajordomeConnectors;
    yield* connectors.list({});
    yield* connectors.list({});
    assert.equal(asked, 1);

    yield* connectors.list({ refresh: true });
    assert.equal(asked, 2);

    yield* TestClock.adjust("61 seconds");
    yield* connectors.list({});
    assert.equal(asked, 3);
  }).pipe(withInstances([instance("claude", { listConnectors: counted })]));
});
