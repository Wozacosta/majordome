import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** Bumped after an undo or a routines move so every vault history in that environment reads again. */
const historyRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:history-revision:${environmentId}`),
  ),
);

export function createMajordomeEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    vaultHistory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:vault-history",
      tag: WS_METHODS.majordomeListVaultHistory,
      staleTimeMs: 10_000,
      refreshTrigger: ({ environmentId }) => historyRevision(environmentId),
    }),
    undoVaultRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:undo-vault-run",
      tag: WS_METHODS.majordomeUndoVaultRun,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.update(historyRevision(environmentId), (value) => value + 1)),
    }),
    runRoutinesHere: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:run-routines-here",
      tag: WS_METHODS.majordomeRunRoutinesHere,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.update(historyRevision(environmentId), (value) => value + 1)),
    }),
  };
}
