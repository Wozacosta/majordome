import { createMajordomeEnvironmentAtoms } from "@t3tools/client-runtime/state/majordome";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const majordomeEnvironment = createMajordomeEnvironmentAtoms(connectionAtomRuntime);

const FEED_HISTORY_LIMIT = 50;

export type VaultProjectRef = readonly [environmentId: EnvironmentId, projectId: ProjectId];

/** Every listed project's vault history, keyed by `JSON.stringify` of its refs. */
export const vaultHistoriesAtom = Atom.family((key: string) => {
  const refs = JSON.parse(key) as ReadonlyArray<VaultProjectRef>;
  return Atom.make((get) =>
    refs.map(([environmentId, projectId]) =>
      get(
        majordomeEnvironment.vaultHistory({
          environmentId,
          input: { projectId, limit: FEED_HISTORY_LIMIT },
        }),
      ),
    ),
  ).pipe(Atom.withLabel(`majordome:vault-histories:${key}`));
});
