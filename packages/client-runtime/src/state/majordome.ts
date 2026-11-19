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
    /** "Set up a server for me": the server's own account of each step, as it happens. */
    serverMove: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:majordome:server-move",
      tag: WS_METHODS.majordomeServerMoveSubscribe,
    }),
    serverMoveSaveKeys: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-save-keys",
      tag: WS_METHODS.majordomeServerMoveSaveKeys,
    }),
    serverMoveForgetKeys: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-forget-keys",
      tag: WS_METHODS.majordomeServerMoveForgetKeys,
    }),
    serverMoveCheck: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-check",
      tag: WS_METHODS.majordomeServerMoveCheck,
    }),
    serverMoveStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-start",
      tag: WS_METHODS.majordomeServerMoveStart,
    }),
    serverMoveRetry: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-retry",
      tag: WS_METHODS.majordomeServerMoveRetry,
    }),
    serverMoveCancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-cancel",
      tag: WS_METHODS.majordomeServerMoveCancel,
    }),
    serverMoveIssuePairingLink: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-pairing-link",
      tag: WS_METHODS.majordomeServerMoveIssuePairingLink,
    }),
    serverMoveRoutines: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-routines",
      tag: WS_METHODS.majordomeServerMoveRoutines,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.update(historyRevision(environmentId), (value) => value + 1)),
    }),
    serverMoveRemove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:server-move-remove",
      tag: WS_METHODS.majordomeServerMoveRemove,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.update(historyRevision(environmentId), (value) => value + 1)),
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
    startNotes: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:start-notes",
      tag: WS_METHODS.majordomeStartNotes,
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
    /** One question, read once per card: its turn item id is part of the key. */
    approval: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:approval",
      tag: WS_METHODS.majordomeGetApproval,
    }),
    answerApproval: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:answer-approval",
      tag: WS_METHODS.majordomeAnswerApproval,
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
    linkPeer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:link-peer",
      tag: WS_METHODS.majordomeLinkPeer,
      onSettled: ({ environmentId }, registry) => bumpBackup(environmentId, registry),
    }),
    unlinkPeer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:unlink-peer",
      tag: WS_METHODS.majordomeUnlinkPeer,
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
    /** Read again on every mount and after each change; the notes can change under it. */
    todos: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:todos",
      tag: WS_METHODS.majordomeListTodos,
      staleTimeMs: 0,
      refreshTrigger: ({ environmentId }) => todosRevision(environmentId),
    }),
    setTodoDone: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:set-todo-done",
      tag: WS_METHODS.majordomeSetTodoDone,
      onSettled: ({ environmentId }, registry) => bumpTodos(environmentId, registry),
    }),
    addTodo: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:add-todo",
      tag: WS_METHODS.majordomeAddTodo,
      onSettled: ({ environmentId }, registry) => bumpTodos(environmentId, registry),
    }),
    /** Read again on every mount and after each change; routines write daily notes too. */
    dailyNote: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:daily-note",
      tag: WS_METHODS.majordomeGetDailyNote,
      staleTimeMs: 0,
      refreshTrigger: ({ environmentId }) => dailyNotesRevision(environmentId),
    }),
    saveDailyNote: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:save-daily-note",
      tag: WS_METHODS.majordomeSaveDailyNote,
      onSettled: ({ environmentId }, registry) => bumpDailyNotes(environmentId, registry),
    }),
    addToDailyNote: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:add-to-daily-note",
      tag: WS_METHODS.majordomeAddToDailyNote,
      onSettled: ({ environmentId }, registry) => bumpDailyNotes(environmentId, registry),
    }),
    /** Read again on every mount and after each change; the assistant adds files too. */
    topicFiles: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:majordome:topic-files",
      tag: WS_METHODS.majordomeListTopicFiles,
      staleTimeMs: 0,
      refreshTrigger: ({ environmentId }) => topicFilesRevision(environmentId),
    }),
    addTopicFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:add-topic-file",
      tag: WS_METHODS.majordomeAddTopicFile,
      onSettled: ({ environmentId }, registry) => bumpTopicFiles(environmentId, registry),
    }),
    removeTopicFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:remove-topic-file",
      tag: WS_METHODS.majordomeRemoveTopicFile,
      onSettled: ({ environmentId }, registry) => bumpTopicFiles(environmentId, registry),
    }),
    viewTopicFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:view-topic-file",
      tag: WS_METHODS.majordomeViewTopicFile,
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
    suggestTopicFolder: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:majordome:suggest-topic-folder",
      tag: WS_METHODS.majordomeSuggestTopicFolder,
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

/** Bumped after any topic change, so every topic list in that environment reads again. */
const topicsRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:topics-revision:${environmentId}`),
  ),
);

const bumpTopics = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => registry.update(topicsRevision(environmentId), (value) => value + 1));

/** Bumped after a to-do is added or ticked, so every to-do list in that environment reads again. */
const todosRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:todos-revision:${environmentId}`),
  ),
);

const dailyNotesRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:daily-notes-revision:${environmentId}`),
  ),
);

const bumpDailyNotes = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => registry.update(dailyNotesRevision(environmentId), (value) => value + 1));

const bumpTodos = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => registry.update(todosRevision(environmentId), (value) => value + 1));

/** Bumped after a file is added or removed, so every topic's files in that environment read again. */
const topicFilesRevision = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:majordome:topic-files-revision:${environmentId}`),
  ),
);

const bumpTopicFiles = (environmentId: EnvironmentId, registry: AtomRegistry.AtomRegistry) =>
  Effect.sync(() => registry.update(topicFilesRevision(environmentId), (value) => value + 1));

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

/**
 * Reads topics, the backup, the feed and private documents again. A conversation that moved on may
 * have changed any of them: an assistant changes settings on the server, not through this client.
 */
export function refreshMajordomeSettings(
  environmentId: EnvironmentId,
  registry: AtomRegistry.AtomRegistry,
): void {
  for (const revision of [
    topicsRevision,
    backupRevision,
    historyRevision,
    privateDocumentsRevision,
  ]) {
    registry.update(revision(environmentId), (value) => value + 1);
  }
}
