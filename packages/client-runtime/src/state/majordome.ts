import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Bumped after an undo, a routines move or new limits so every vault history there reads again. */
const historyRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:history-revision:${environmentId}`),
  ),
);

/** Bumped to read the phone setup again, after "Check again" or turning on the secure address. */
export const phoneSetupRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:phone-setup-revision:${environmentId}`),
  ),
);

export function createMajordomeEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pushConfig: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:push-config",
      tag: WS_METHODS.majordomeGetPushConfig,
    }),
    savePushSubscription: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:save-push-subscription",
      tag: WS_METHODS.majordomeSavePushSubscription,
      onSettled: ({ environmentId }, registry) => bumpPushDevices(environmentId, registry),
    }),
    removePushSubscription: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:remove-push-subscription",
      tag: WS_METHODS.majordomeRemovePushSubscription,
      onSettled: ({ environmentId }, registry) => bumpPushDevices(environmentId, registry),
    }),
    pushDevices: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:push-devices",
      tag: WS_METHODS.majordomeListPushDevices,
      refreshTrigger: ({ environmentId }) => pushDevicesRevision(environmentId),
    }),
    sendTestPush: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:send-test-push",
      tag: WS_METHODS.majordomeSendTestPush,
    }),
    phoneSetup: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:phone-setup",
      tag: WS_METHODS.majordomeGetPhoneSetup,
      refreshTrigger: ({ environmentId }) => phoneSetupRevision(environmentId),
    }),
    enableSecureAddress: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:enable-secure-address",
      tag: WS_METHODS.majordomeEnableSecureAddress,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.update(phoneSetupRevision(environmentId), (value) => value + 1)),
    }),
    vaultHistory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:vault-history",
      tag: WS_METHODS.majordomeListVaultHistory,
      staleTimeMs: 10_000,
      refreshTrigger: ({ environmentId }) => historyRevision(environmentId),
    }),
    vaultChanges: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:majordome:vault-changes",
      tag: WS_METHODS.majordomeSubscribeVaultChanges,
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
    setRoutineLimits: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:set-routine-limits",
      tag: WS_METHODS.majordomeSetRoutineLimits,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.update(historyRevision(environmentId), (value) => value + 1)),
    }),
    backupStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:backup-status",
      tag: WS_METHODS.majordomeGetBackupStatus,
      staleTimeMs: 30_000,
      refreshTrigger: ({ environmentId }) => backupRevision(environmentId),
    }),
    connectors: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:connectors",
      tag: WS_METHODS.majordomeListConnectors,
      staleTimeMs: 60_000,
      refreshTrigger: ({ environmentId }) => connectorsRevision(environmentId),
    }),
    /** One query per typed search; nothing is kept, so results are never older than the notes. */
    notesSearch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:notes-search",
      tag: WS_METHODS.majordomeSearchNotes,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    notesIndexStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:notes-index-status",
      tag: WS_METHODS.majordomeGetNotesIndexStatus,
      staleTimeMs: 30_000,
      refreshTrigger: ({ environmentId }) => notesIndexRevision(environmentId),
    }),
    rebuildNotesIndex: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:rebuild-notes-index",
      tag: WS_METHODS.majordomeRebuildNotesIndex,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.update(notesIndexRevision(environmentId), (value) => value + 1)),
    }),
    /** Run with `refresh: true`: the server asks its providers again, then `connectors` reads that. */
    checkConnectors: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:check-connectors",
      tag: WS_METHODS.majordomeListConnectors,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.update(connectorsRevision(environmentId), (value) => value + 1)),
    }),
    privateDocuments: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:private-documents",
      tag: WS_METHODS.majordomeListPrivateDocuments,
      staleTimeMs: 10_000,
      refreshTrigger: ({ environmentId }) => privateDocumentsRevision(environmentId),
    }),
    addPrivateDocument: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:add-private-document",
      tag: WS_METHODS.majordomeAddPrivateDocument,
      onSettled: ({ environmentId }, registry) => bumpPrivateDocuments(environmentId, registry),
    }),
    removePrivateDocument: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:remove-private-document",
      tag: WS_METHODS.majordomeRemovePrivateDocument,
      onSettled: ({ environmentId }, registry) => bumpPrivateDocuments(environmentId, registry),
    }),
    viewPrivateDocument: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:view-private-document",
      tag: WS_METHODS.majordomeViewPrivateDocument,
      onSettled: ({ environmentId }, registry) => bumpPrivateDocuments(environmentId, registry),
    }),
    /** One request, read once per card: its turn item id is part of the key. */
    privateDocumentRequest: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:private-document-request",
      tag: WS_METHODS.majordomeGetPrivateDocumentRequest,
      refreshTrigger: ({ environmentId }) => privateDocumentsRevision(environmentId),
    }),
    answerPrivateDocumentRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:answer-private-document-request",
      tag: WS_METHODS.majordomeAnswerPrivateDocumentRequest,
      onSettled: ({ environmentId }, registry) => bumpPrivateDocuments(environmentId, registry),
    }),
    backUpNow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:back-up-now",
      tag: WS_METHODS.majordomeBackUpNow,
      onSettled: ({ environmentId }, registry) => bumpBackup(environmentId, registry),
    }),
    configureBackup: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:configure-backup",
      tag: WS_METHODS.majordomeConfigureBackup,
      onSettled: ({ environmentId }, registry) => bumpBackup(environmentId, registry),
    }),
    connectGitHubStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:connect-github-start",
      tag: WS_METHODS.majordomeConnectGitHubStart,
    }),
    connectGitHubWait: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:connect-github-wait",
      tag: WS_METHODS.majordomeConnectGitHubWait,
      onSettled: ({ environmentId }, registry) => bumpBackup(environmentId, registry),
    }),
    connectGitHubCancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:connect-github-cancel",
      tag: WS_METHODS.majordomeConnectGitHubCancel,
    }),
    connectGoogleDriveStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:connect-google-drive-start",
      tag: WS_METHODS.majordomeConnectGoogleDriveStart,
    }),
    connectGoogleDriveWait: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:connect-google-drive-wait",
      tag: WS_METHODS.majordomeConnectGoogleDriveWait,
      onSettled: ({ environmentId }, registry) => bumpBackup(environmentId, registry),
    }),
    connectGoogleDriveCancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:connect-google-drive-cancel",
      tag: WS_METHODS.majordomeConnectGoogleDriveCancel,
    }),
    topics: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:topics",
      tag: WS_METHODS.majordomeListTopics,
      staleTimeMs: 30_000,
      refreshTrigger: ({ environmentId }) => topicsRevision(environmentId),
    }),
    createTopic: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:create-topic",
      tag: WS_METHODS.majordomeCreateTopic,
      onSettled: ({ environmentId }, registry) => bumpTopics(environmentId, registry),
    }),
    updateTopic: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:update-topic",
      tag: WS_METHODS.majordomeUpdateTopic,
      onSettled: ({ environmentId }, registry) => bumpTopics(environmentId, registry),
    }),
    reorderTopics: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:reorder-topics",
      tag: WS_METHODS.majordomeReorderTopics,
      onSettled: ({ environmentId }, registry) => bumpTopics(environmentId, registry),
    }),
    removeTopic: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:remove-topic",
      tag: WS_METHODS.majordomeRemoveTopic,
      onSettled: ({ environmentId }, registry) => bumpTopics(environmentId, registry),
    }),
    openTopic: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:open-topic",
      tag: WS_METHODS.majordomeOpenTopic,
      onSettled: ({ environmentId }, registry) => bumpTopics(environmentId, registry),
    }),
    openRoutinesConversation: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:open-routines-conversation",
      tag: WS_METHODS.majordomeOpenRoutinesConversation,
      onSettled: ({ environmentId }, registry) => bumpTopics(environmentId, registry),
    }),
    dismissTopicSuggestions: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:dismiss-topic-suggestions",
      tag: WS_METHODS.majordomeDismissTopicSuggestions,
      onSettled: ({ environmentId }, registry) => bumpTopics(environmentId, registry),
    }),
  };
}

/**
 * Bumped after any topic change, or when a topic's conversation moves on, so every topic list in
 * that environment reads again.
 */
export const topicsRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:topics-revision:${environmentId}`),
  ),
);

const bumpTopics = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => registry.update(topicsRevision(environmentId), (value) => value + 1));

/** Bumped after a rebuild, so the notes search status reads again. */
const notesIndexRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:notes-index-revision:${environmentId}`),
  ),
);

/** Bumped after "Check again", so the connectors list reads the server's fresh answer. */
const connectorsRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:connectors-revision:${environmentId}`),
  ),
);

/** Bumped after a private document is added, removed, viewed or answered for, so the page reads again. */
const privateDocumentsRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:private-documents-revision:${environmentId}`),
  ),
);

const bumpPrivateDocuments = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => registry.update(privateDocumentsRevision(environmentId), (value) => value + 1));

/** Bumped when a device turns notifications on or off, so the device list reads again. */
const pushDevicesRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:push-devices-revision:${environmentId}`),
  ),
);

const bumpPushDevices = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => registry.update(pushDevicesRevision(environmentId), (value) => value + 1));

/** Bumped after a backup action so the backup status, and the feed it may have added to, read again. */
const backupRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:backup-revision:${environmentId}`),
  ),
);

const bumpBackup = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => {
    registry.update(backupRevision(environmentId), (value) => value + 1);
    registry.update(historyRevision(environmentId), (value) => value + 1);
  });
