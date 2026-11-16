import { createMajordomeEnvironmentAtoms } from "@t3tools/client-runtime/state/majordome";
import type { EnvironmentId, ProjectId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { serverEnvironment } from "./server";

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

/** Every listed vault's notes search status, keyed like `vaultHistoriesAtom`. */
export const vaultNotesIndexStatusesAtom = Atom.family((key: string) => {
  const refs = JSON.parse(key) as ReadonlyArray<VaultProjectRef>;
  return Atom.make((get) =>
    refs.map(([environmentId, projectId]) =>
      get(majordomeEnvironment.notesIndexStatus({ environmentId, input: { projectId } })),
    ),
  ).pipe(Atom.withLabel(`majordome:vault-notes-index-statuses:${key}`));
});

/**
 * What the Overview reads from each listed server: its routines, private documents and settings.
 * Keyed by `JSON.stringify` of the environment ids.
 */
export const environmentOverviewsAtom = Atom.family((key: string) => {
  const environmentIds = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
  return Atom.make((get) =>
    environmentIds.map((environmentId) => ({
      tasks: get(serverEnvironment.scheduledTasksLive({ environmentId, input: {} })),
      privateDocuments: get(majordomeEnvironment.privateDocuments({ environmentId, input: {} })),
      settings: get(serverEnvironment.settingsValueAtom(environmentId)),
    })),
  ).pipe(Atom.withLabel(`majordome:environment-overviews:${key}`));
});

/** What each listed server has scheduled, kept live; keyed like `environmentOverviewsAtom`. */
export const environmentScheduledTasksAtom = Atom.family((key: string) => {
  const environmentIds = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
  return Atom.make((get) =>
    environmentIds.map((environmentId) =>
      get(serverEnvironment.scheduledTasksLive({ environmentId, input: {} })),
    ),
  ).pipe(Atom.withLabel(`majordome:environment-scheduled-tasks:${key}`));
});

export type PrivateDocumentRequestRef = readonly [
  environmentId: EnvironmentId,
  threadId: ThreadId,
  turnItemId: TurnItemId,
];

/** Each listed card's private document request, keyed by `JSON.stringify` of its refs. */
export const privateDocumentRequestsAtom = Atom.family((key: string) => {
  const refs = JSON.parse(key) as ReadonlyArray<PrivateDocumentRequestRef>;
  return Atom.make((get) =>
    refs.map(([environmentId, threadId, turnItemId]) =>
      get(
        majordomeEnvironment.privateDocumentRequest({
          environmentId,
          input: { threadId, turnItemId },
        }),
      ),
    ),
  ).pipe(Atom.withLabel(`majordome:private-document-requests:${key}`));
});
