import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createMajordomeEnvironmentAtoms } from "@t3tools/client-runtime/state/majordome";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const majordomeEnvironment = createMajordomeEnvironmentAtoms(connectionAtomRuntime);

export type VaultRef = readonly [environmentId: EnvironmentId, projectId: ProjectId];

/** Every listed project's topics, which says which one is the notes folder. Keyed by its refs as JSON. */
export const vaultTopicsAtom = Atom.family((key: string) => {
  const refs = JSON.parse(key) as ReadonlyArray<VaultRef>;
  return Atom.make((get) =>
    refs.map(([environmentId, projectId]) =>
      get(majordomeEnvironment.topics({ environmentId, input: { projectId } })),
    ),
  ).pipe(Atom.withLabel(`majordome:vault-topics:${key}`));
});
