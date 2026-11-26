import { createMajordomeEnvironmentAtoms } from "@t3tools/client-runtime/state/majordome";
import type { EnvironmentId, ProjectId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { serverEnvironment } from "./server";

/** A server's runs as its live list of routines tells them: who ran last, how, and what is next. */
const routineRunsSignature = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const list = AsyncResult.getOrElse(
      get(serverEnvironment.scheduledTasksLive({ environmentId, input: {} })),
      () => null,
    );
    return (list?.tasks ?? [])
      .map((task) =>
        [task.id, task.lastRunAt, task.lastRunStatus, task.lastRunErrorCode, task.nextRunAt].join(
          " ",
        ),
      )
      .join("\n");
  }).pipe(Atom.withLabel(`majordome:routine-runs-signature:${environmentId}`)),
);

export const majordomeEnvironment = createMajordomeEnvironmentAtoms(connectionAtomRuntime, {
  routineRunsChanged: routineRunsSignature,
});

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

/**
 * Every listed project's runs from `from` up to `to`, keyed by `JSON.stringify` of
 * `{ refs, from, to }`.
 */
export const vaultRoutineRunsAtom = Atom.family((key: string) => {
  const { refs, from, to } = JSON.parse(key) as {
    readonly refs: ReadonlyArray<VaultProjectRef>;
    readonly from: string;
    readonly to: string;
  };
  return Atom.make((get) =>
    refs.map(([environmentId, projectId]) =>
      get(majordomeEnvironment.routineRuns({ environmentId, input: { projectId, from, to } })),
    ),
  ).pipe(Atom.withLabel(`majordome:vault-routine-runs:${key}`));
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

/**
 * A brain's files from each server that has a copy of it, keyed like `vaultHistoriesAtom`. The
 * first server answers with everything; the notes are the same on the others, so those are asked
 * for their chats' files only.
 */
export const vaultLibrariesAtom = Atom.family((key: string) => {
  const refs = JSON.parse(key) as ReadonlyArray<VaultProjectRef>;
  return Atom.make((get) =>
    refs.map(([environmentId, projectId], index) =>
      get(
        majordomeEnvironment.library({
          environmentId,
          input: index === 0 ? { projectId } : { projectId, chatsOnly: true },
        }),
      ),
    ),
  ).pipe(Atom.withLabel(`majordome:vault-libraries:${key}`));
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

/** Each listed computer's saved keys, in the order given; keyed by the JSON list of their ids. */
export const savedKeysOnAtom = Atom.family((key: string) => {
  const ids = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
  return Atom.make((get) =>
    ids.map((environmentId) => get(majordomeEnvironment.savedKeys({ environmentId, input: {} }))),
  ).pipe(Atom.withLabel(`majordome:saved-keys-on:${key}`));
});

/** Whether this app may save and remove keys on each listed computer, keyed like `savedKeysOnAtom`. */
export const savedKeysWritableOnAtom = Atom.family((key: string) => {
  const ids = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
  return Atom.make((get) =>
    ids.map((environmentId) => get(majordomeEnvironment.saveKey.permissionAtom(environmentId))),
  ).pipe(Atom.withLabel(`majordome:saved-keys-writable-on:${key}`));
});
