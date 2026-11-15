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

/** Every listed project's backup status, keyed like `vaultHistoriesAtom`. */
export const vaultBackupStatusesAtom = Atom.family((key: string) => {
  const refs = JSON.parse(key) as ReadonlyArray<VaultProjectRef>;
  return Atom.make((get) =>
    refs.map(([environmentId, projectId]) =>
      get(majordomeEnvironment.backupStatus({ environmentId, input: { projectId } })),
    ),
  ).pipe(Atom.withLabel(`majordome:vault-backup-statuses:${key}`));
});

/** Every listed project's topics, which also says which projects are vaults; keyed like `vaultHistoriesAtom`. */
export const vaultTopicsAtom = Atom.family((key: string) => {
  const refs = JSON.parse(key) as ReadonlyArray<VaultProjectRef>;
  return Atom.make((get) =>
    refs.map(([environmentId, projectId]) =>
      get(majordomeEnvironment.topics({ environmentId, input: { projectId } })),
    ),
  ).pipe(Atom.withLabel(`majordome:vault-topics:${key}`));
});
