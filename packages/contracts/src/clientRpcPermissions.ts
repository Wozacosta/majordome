import * as Schema from "effect/Schema";
import { GitPreparePullRequestThreadInput, GitRunStackedActionInput } from "./git.ts";
import {
  AuthAccessWriteScope,
  AuthEnvironmentMaintainScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  AuthSourceControlWriteScope,
  AuthTerminalOperateScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS } from "./rpc.ts";

/** Incremental client enforcement; the server still authorizes every request. */
export const CLIENT_GUARDED_RPC_SCOPES = {
  [WS_METHODS.providerAuthRemoveMethod]: AuthProvidersManageScope,
  // Replaces the provider's Claude login, as saving its sign-in token in Settings does.
  [WS_METHODS.claudeSignInStart]: AuthProvidersManageScope,
  [WS_METHODS.claudeSignInSubmit]: AuthProvidersManageScope,
  [WS_METHODS.claudeSignInCancel]: AuthProvidersManageScope,
  [WS_METHODS.previewClose]: AuthPreviewOperateScope,
  // Stopping a server signals its processes, as closing a terminal does.
  [WS_METHODS.previewStopLocalServer]: AuthTerminalOperateScope,
  [WS_METHODS.serverRunStorageCleanup]: AuthSettingsWriteScope,
  // Restarts the server, as an update does.
  [WS_METHODS.serverReclaimDatabaseSpace]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverCheckOtlpEndpoint]: AuthSettingsWriteScope,
  [WS_METHODS.serverCheckSecretSource]: AuthSettingsWriteScope,
  // Listing models spends the stored API key, so only those who can choose a model may.
  [WS_METHODS.serverListTextGeneratorModels]: AuthSettingsWriteScope,
  [WS_METHODS.serverRefreshProviders]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRunAction]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsUpdate]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsComment]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsUpdateComment]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSubmitReview]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsReplyToThread]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetThreadResolution]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetReaction]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetFilesViewed]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsRequestReviewers]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetLabels]: AuthSourceControlWriteScope,
  [WS_METHODS.issuesCreate]: AuthSourceControlWriteScope,
  [WS_METHODS.issuesComment]: AuthSourceControlWriteScope,
  [WS_METHODS.issuesUpdate]: AuthSourceControlWriteScope,
  [WS_METHODS.issuesSetState]: AuthSourceControlWriteScope,
  [WS_METHODS.issuesReact]: AuthSourceControlWriteScope,
  // A tracker credential and a project's binding are settings, saved under the same grant.
  [WS_METHODS.issueTrackersConnect]: AuthSettingsWriteScope,
  [WS_METHODS.issueTrackersBindProject]: AuthSettingsWriteScope,
  // Writing a guide runs a model on this environment's providers, which reading one does not.
  [WS_METHODS.pullRequestsGenerateReviewGuide]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectsCreateFromThread]: AuthOrchestrationOperateScope,
  [WS_METHODS.sourceControlCloneRepository]: AuthSourceControlWriteScope,
  [WS_METHODS.sourceControlPublishRepository]: AuthSourceControlWriteScope,
  [WS_METHODS.sourceControlStar]: AuthSourceControlWriteScope,
  // Signing in replaces the server's GitHub credential, as saving a token in Settings does.
  [WS_METHODS.sourceControlSignInStart]: AuthSettingsWriteScope,
  [WS_METHODS.sourceControlSignInWait]: AuthSettingsWriteScope,
  [WS_METHODS.sourceControlSignInCancel]: AuthSettingsWriteScope,
  [WS_METHODS.projectCloneStart]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneCancel]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneRetry]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsPull]: AuthSourceControlWriteScope,
  [WS_METHODS.gitRunStackedAction]: AuthSourceControlWriteScope,
  [WS_METHODS.gitPreparePullRequestThread]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsCreateWorktree]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsRemoveWorktree]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsCreateRef]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsSwitchRef]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsInit]: AuthSourceControlWriteScope,

  // Starts an agent session on this environment that can read its logs and database.
  [WS_METHODS.serverPrepareTriage]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksUpsert]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksSetEnabled]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksRunNow]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksRotateWebhookToken]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeSavePushSubscription]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeRemovePushSubscription]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeSendTestPush]: AuthOrchestrationOperateScope,
  // Puts this server on the tailnet's HTTPS address, which is how phones pair with it.
  [WS_METHODS.majordomeEnableSecureAddress]: AuthAccessWriteScope,
  // Opens or closes this server's public address, reachable from the whole internet.
  [WS_METHODS.majordomeEnableAnywhereAddress]: AuthAccessWriteScope,
  [WS_METHODS.majordomeDisableAnywhereAddress]: AuthAccessWriteScope,
  // Rents a billed server, adds a device to the owner's tailnet and hands out pairing links;
  // even its check spends the saved Hetzner and Tailscale keys.
  [WS_METHODS.majordomeServerMoveSaveKeys]: AuthAccessWriteScope,
  [WS_METHODS.majordomeServerMoveForgetKeys]: AuthAccessWriteScope,
  [WS_METHODS.majordomeServerMoveCheck]: AuthAccessWriteScope,
  [WS_METHODS.majordomeServerMoveStart]: AuthAccessWriteScope,
  [WS_METHODS.majordomeServerMoveRetry]: AuthAccessWriteScope,
  [WS_METHODS.majordomeServerMoveCancel]: AuthAccessWriteScope,
  [WS_METHODS.majordomeServerMoveIssuePairingLink]: AuthAccessWriteScope,
  [WS_METHODS.majordomeServerMoveRoutines]: AuthAccessWriteScope,
  [WS_METHODS.majordomeServerMoveRemove]: AuthAccessWriteScope,
  [WS_METHODS.majordomeUndoVaultRun]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeRunRoutinesHere]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeAddReadyRoutine]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeSetRoutineLimits]: AuthSettingsWriteScope,
  // Writes files and a git history into a folder on the server and opens it as a project.
  [WS_METHODS.majordomeStartNotes]: AuthOrchestrationOperateScope,
  // Like starting notes: it only ever makes a new folder, and keeps no passphrase.
  [WS_METHODS.majordomeRestoreNotes]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeBackUpNow]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeRebuildNotesIndex]: AuthOrchestrationOperateScope,
  // Backup settings hold a passphrase and a GitHub sign-in, like credentials saved in Settings.
  [WS_METHODS.majordomeConfigureBackup]: AuthSettingsWriteScope,
  // Hands this server a session on another of the owner's machines.
  [WS_METHODS.majordomeLinkPeer]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeUnlinkPeer]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeAddPrivateDocument]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeRemovePrivateDocument]: AuthSettingsWriteScope,
  // Hands out the decrypted file, so it needs more than the scope that lists the names.
  [WS_METHODS.majordomeViewPrivateDocument]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeAnswerPrivateDocumentRequest]: AuthOrchestrationOperateScope,
  // A yes changes a setting, so it takes the scope that could change it directly.
  [WS_METHODS.majordomeAnswerApproval]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeConnectGitHubStart]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeConnectGitHubWait]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeConnectGitHubCancel]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeConnectGoogleDriveStart]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeConnectGoogleDriveWait]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeConnectGoogleDriveCancel]: AuthSettingsWriteScope,
  [WS_METHODS.majordomeCreateTopic]: AuthOrchestrationOperateScope,
  // Asks a model, on the owner's plan.
  [WS_METHODS.majordomeSuggestTopicFolder]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeUpdateTopic]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeReorderTopics]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeRemoveTopic]: AuthOrchestrationOperateScope,
  // Starts the topic's thread the first time it is opened.
  [WS_METHODS.majordomeOpenTopic]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeSetThreadTopic]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeOpenRoutinesConversation]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeDismissTopicSuggestions]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeAddReadingItem]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeUpdateReadingItem]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeReorderReadingItems]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeRemoveReadingItem]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeRestoreReadingItem]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeSaveReadingSubjects]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeKeepSkill]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeRemoveSkill]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeSetTodoDone]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeAddTodo]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeSaveDailyNote]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeSaveNote]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeAddToDailyNote]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeAddTopicFile]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeRemoveTopicFile]: AuthOrchestrationOperateScope,
  [WS_METHODS.majordomeDrawConversation]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: AuthOrchestrationOperateScope,
  // Force stop kills agent processes, as Stop on a terminal does.
  [ORCHESTRATION_V2_WS_METHODS.forceStopThread]: AuthOrchestrationOperateScope,
  // A guest link hands thread access to someone outside, like a pairing link.
  [WS_METHODS.guestShareCreate]: AuthAccessWriteScope,
  [WS_METHODS.peerLinksLink]: AuthAccessWriteScope,
  [WS_METHODS.peerLinksUnlink]: AuthAccessWriteScope,
  // A link lets every agent here reach the other environment: Settings' bar.
  [WS_METHODS.peerLinksAnswerRequest]: AuthAccessWriteScope,
} as const;
export type ClientGuardedRpcTag = keyof typeof CLIENT_GUARDED_RPC_SCOPES;

const decodePrepareThread = Schema.decodeUnknownSync(GitPreparePullRequestThreadInput);
const decodeStackedAction = Schema.decodeUnknownSync(GitRunStackedActionInput);

export function clientRpcRequiredScopes(
  method: string,
  input: unknown,
): readonly AuthEnvironmentScope[] {
  if (method === WS_METHODS.gitPreparePullRequestThread && input !== undefined) {
    const payload = decodePrepareThread(input);
    if (payload.mode === "worktree" && payload.threadId !== undefined)
      return [AuthSourceControlWriteScope, AuthOrchestrationOperateScope];
  }
  if (method === WS_METHODS.gitRunStackedAction && input !== undefined) {
    const payload = decodeStackedAction(input);
    if (
      payload.threadId !== undefined &&
      (payload.action === "create_pr" || payload.action === "commit_push_pr")
    )
      return [AuthSourceControlWriteScope, AuthOrchestrationReadScope];
  }
  return Object.hasOwn(CLIENT_GUARDED_RPC_SCOPES, method)
    ? [CLIENT_GUARDED_RPC_SCOPES[method as ClientGuardedRpcTag]]
    : [];
}
