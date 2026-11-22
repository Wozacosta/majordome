import {
  OrchestrationV2SearchThreadError,
  OrchestrationV2SearchThreadInput,
  OrchestrationV2SearchThreadResult,
  OrchestrationV2SearchThreadsInput,
  OrchestrationV2SearchThreadsResult,
} from "./orchestrationV2.ts";
import { OrchestrationDispatchCommandError } from "./orchestrationDispatch.ts";
import {
  McpAppCallToolInput,
  McpAppCallToolResult,
  McpAppReadResourceInput,
  McpAppReadResourceResult,
  McpAppRequestError,
  McpAppToolInfo,
  McpAppToolInfoInput,
  McpAppUpdateModelContextInput,
} from "./mcpApps.ts";
import {
  PeerLink,
  PeerLinkCreateInput,
  PeerLinkError,
  PeerLinkRemoveInput,
  PeerLinkRemoveResult,
  PeerLinkRequestAnswerInput,
  PeerLinkRequestError,
  PeerLinkSummary,
} from "./peerLink.ts";
import {
  ChatGptReconnectProfileInput,
  ChatGptReconnectProfile,
  ChatGptImportProfileInput,
  ChatGptHandoffInput,
  ChatGptHandoffState,
} from "./providerSetup.ts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { SecretSourceCheckResult } from "./settingsSecretValue.ts";
import { SecretReference } from "./secretReference.ts";
import {
  ClaudeSignInAttempt,
  ClaudeSignInCancelInput,
  ClaudeSignInError,
  ClaudeSignInResult,
  ClaudeSignInSubmitInput,
  ProviderAuthCancelInput,
  ProviderAuthCompleteInput,
  ProviderAuthState,
  ProviderAuthStartInput,
  ProviderAuthRemoveMethodInput,
  ProviderAuthRespondInput,
  ProviderInstallCancelInput,
  ProviderInstallState,
  ProviderSetupError,
  ProviderSetupInput,
} from "./providerSetup.ts";

import {
  AcpRegistryAcceptUrlAuthInput,
  AcpRegistryAcceptUrlAuthResult,
  AcpRegistryDeleteSessionInput,
  AcpRegistryDeleteSessionResult,
  AcpRegistryDisableProviderInput,
  AcpRegistryDisableProviderResult,
  AcpRegistryImportSessionInput,
  AcpRegistryImportSessionResult,
  AcpRegistryListSessionsInput,
  AcpRegistryListSessionsResult,
  AcpRegistryListProvidersInput,
  AcpRegistryListProvidersResult,
  AcpRegistryLogoutInput,
  AcpRegistryLogoutResult,
  AcpRegistryManagedBinaryUninstallInput,
  AcpRegistryManagedBinaryUninstallResult,
  AcpRegistryOperationError,
  AcpRegistryPrepareInput,
  AcpRegistryPrepareResult,
  AcpRegistrySearchInput,
  AcpRegistrySearchResult,
  AcpRegistrySetProviderInput,
  AcpRegistrySetProviderResult,
} from "./acpRegistry.ts";
import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import {
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import { ClientActivityReportInput } from "./background.ts";
import {
  MajordomeRoutineLimits,
  MajordomeRunRoutinesHereInput,
  MajordomeReadyRoutinesInput,
  MajordomeReadyRoutinesResult,
  MajordomeAddReadyRoutineInput,
  MajordomeVaultChangesInput,
  MajordomeSetRoutineLimitsInput,
  MajordomeStartNotesInput,
  MajordomeStartNotesResult,
  MajordomeVaultError,
  MajordomeVaultHistoryInput,
  MajordomeVaultHistoryResult,
  MajordomeVaultUndoInput,
  MajordomeVaultUndoResult,
} from "./majordome.ts";
import {
  MajordomePhoneError,
  MajordomePhoneSetup,
  MajordomePushConfig,
  MajordomePushDevices,
  MajordomePushEndpointInput,
  MajordomeSavePushSubscriptionInput,
} from "./majordomePhone.ts";
import {
  MajordomeServerMoveCancelInput,
  MajordomeServerMoveCheck,
  MajordomeServerMoveCheckInput,
  MajordomeServerMoveError,
  MajordomeServerMovePairingLink,
  MajordomeServerMoveRemoveInput,
  MajordomeServerMoveSaveKeysInput,
  MajordomeServerMoveStartInput,
  MajordomeServerMoveStatus,
} from "./majordomeServerMove.ts";
import { MajordomeConnectorsInput, MajordomeConnectorsResult } from "./majordomeConnectors.ts";
import {
  MajordomeNotesIndexInput,
  MajordomeNotesIndexResult,
  MajordomeNotesSearchError,
  MajordomeNotesSearchInput,
  MajordomeNotesSearchResult,
} from "./majordomeNotesSearch.ts";
import {
  MajordomeAnswerApprovalInput,
  MajordomeApproval,
  MajordomeApprovalError,
  MajordomeApprovalInput,
} from "./majordomeApprovals.ts";
import {
  MajordomeAddPrivateDocumentInput,
  MajordomeAnswerPrivateDocumentRequestInput,
  MajordomePrivateDocument,
  MajordomePrivateDocumentError,
  MajordomePrivateDocumentInput,
  MajordomePrivateDocumentRequest,
  MajordomePrivateDocumentRequestInput,
  MajordomePrivateDocumentsResult,
  MajordomeViewPrivateDocumentResult,
} from "./majordomePrivateDocuments.ts";
import {
  MajordomeBackupInput,
  MajordomeBackUpNowInput,
  MajordomeBackupStatus,
  MajordomeConfigureBackupInput,
  MajordomeGitHubConnectPrompt,
  MajordomeGoogleDriveConnectPrompt,
  MajordomeLinkPeerInput,
} from "./majordomeBackup.ts";
import {
  MajordomeAddTodoInput,
  MajordomeSetTodoDoneInput,
  MajordomeTodosError,
  MajordomeTodosInput,
  MajordomeTodosResult,
} from "./majordomeTodos.ts";
import {
  MajordomeAddToDailyNoteInput,
  MajordomeDailyNoteError,
  MajordomeDailyNoteInput,
  MajordomeDailyNoteResult,
  MajordomeSaveDailyNoteInput,
} from "./majordomeDaily.ts";
import { MajordomeNoteError, MajordomeSaveNoteInput } from "./majordomeNotes.ts";
import {
  MajordomeAddTopicFileInput,
  MajordomeTopicFile,
  MajordomeTopicFileInput,
  MajordomeTopicFilesError,
  MajordomeTopicFilesInput,
  MajordomeTopicFilesResult,
  MajordomeViewTopicFileResult,
} from "./majordomeTopicFiles.ts";
import {
  MajordomeDrawConversationError,
  MajordomeDrawConversationInput,
  MajordomeDrawConversationResult,
  MajordomeKeyFactsInput,
  MajordomeKeyFactsResult,
} from "./majordomeKeyFacts.ts";
import {
  MajordomeCreateTopicInput,
  MajordomeDismissTopicSuggestionsInput,
  MajordomeOpenRoutinesConversationInput,
  MajordomeOpenTopicInput,
  MajordomeOpenTopicResult,
  MajordomeSetThreadTopicInput,
  MajordomeReorderTopicsInput,
  MajordomeSuggestTopicFolderInput,
  MajordomeSuggestTopicFolderResult,
  MajordomeTopic,
  MajordomeTopicRefInput,
  MajordomeTopicsError,
  MajordomeTopicsInput,
  MajordomeTopicsResult,
  MajordomeUpdateTopicInput,
} from "./majordomeTopics.ts";
import {
  MajordomeAddReadingItemInput,
  MajordomeAddReadingItemResult,
  MajordomeReadingItem,
  MajordomeReadingItemRefInput,
  MajordomeReadingListError,
  MajordomeReadingListInput,
  MajordomeReadingListResult,
  MajordomeReorderReadingItemsInput,
  MajordomeRestoreReadingItemInput,
  MajordomeSaveReadingSubjectsInput,
  MajordomeSaveReadingSubjectsResult,
  MajordomeUpdateReadingItemInput,
} from "./majordomeReadingList.ts";
import {
  FilesystemGetMetadataInput,
  FilesystemGetMetadataResult,
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  AgentSessionImportInput,
  AgentSessionImportProjectChangedError,
  AgentSessionImportProjectNotFoundError,
  AgentSessionImportResult,
  AgentSessionScanInput,
  AgentSessionScanResult,
  AgentSessionScanError,
} from "./agentSessions.ts";
import {
  AssetAccessError,
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  AttachmentCreateUploadUrlInput,
  AttachmentCreateUploadUrlResult,
  AttachmentDeleteInput,
  AttachmentUploadSigningKeyError,
} from "./assets.ts";
import {
  PersistChatAttachmentsError,
  PersistChatAttachmentsInput,
  PersistChatAttachmentsResult,
} from "./chatAttachment.ts";
import {
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetTurnDiffError,
} from "./checkpointDiff.ts";
import {
  WorktreeSetupCancelInput,
  WorktreeSetupCancelResult,
  WorktreeSetupStreamEvent,
  WorktreeSetupSubscribeInput,
} from "./worktreeSetup.ts";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsBranchStatus,
  VcsStatusSubscriptionInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import {
  ReviewBranchCommitsInput,
  ReviewBranchCommitsResult,
  ReviewDiffFileContentsInput,
  ReviewDiffFileContentsResult,
  ReviewDiffPreviewError,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import { OrchestrationSearchThreadsError } from "./threadSearch.ts";
import {
  ProviderUploadFeedbackError,
  ProviderUploadFeedbackInput,
  ProviderUploadFeedbackResult,
} from "./provider.ts";
import { ProviderInstanceId, ProviderInstanceMutation } from "./providerInstance.ts";
import {
  IssueCandidates,
  IssueCommentInput,
  IssueCommentsPage,
  IssueCommentsPageInput,
  IssueCreateInput,
  IssueCreateResult,
  IssueDetail,
  IssueLinkedThreadsResult,
  IssueListInput,
  IssueListResult,
  IssueOperationError,
  IssueReactionInput,
  IssueRef,
  IssueScopeRef,
  IssueSetStateInput,
  IssueTemplateList,
  IssueTrackerBindProjectInput,
  IssueTrackerConnectInput,
  IssueTrackerConnection,
  IssueTrackerConnectionError,
  IssueTrackerConnectionList,
  IssueUnavailableError,
  IssueUpdateInput,
  ThreadIssueKey,
} from "./issue.ts";
import {
  GuestShareCreateError,
  GuestShareCreateInput,
  GuestShareCreateResult,
} from "./guestShare.ts";
import { PullRequestReviewGuideResult } from "./pullRequestReviewGuide.ts";
import {
  PullRequestActionInput,
  PullRequestActivity,
  PullRequestChangeBreakdown,
  PullRequestCommentInput,
  PullRequestCommentUpdateInput,
  PullRequestDetail,
  PullRequestPreview,
  PullRequestChecks,
  PullRequestDiffFileContentsInput,
  PullRequestDiffFileContentsResult,
  PullRequestFilesViewedResult,
  PullRequestInvalidateInput,
  PullRequestReportStateInput,
  PullRequestListInput,
  PullRequestListResult,
  PullRequestListStatsInput,
  PullRequestListStatsResult,
  PullRequestFilterOptions,
  PullRequestFilterOptionsInput,
  PullRequestOperationError,
  PullRequestReactionInput,
  PullRequestRef,
  PullRequestRoutingResult,
  PullRequestRoutingIdentityInput,
  PullRequestRoutingIdentityResult,
  PullRequestStack,
  PullRequestLinkedThreadsResult,
  PullRequestSummary,
  PullRequestReviewerCandidateList,
  PullRequestReviewerCandidatesInput,
  PullRequestReviewerRequestInput,
  PullRequestLabelCandidateList,
  PullRequestLabelChangeInput,
  PullRequestSetFilesViewedInput,
  PullRequestSubmitReviewInput,
  PullRequestThreadCommentsInput,
  PullRequestThreadCommentsResult,
  PullRequestThreadReplyInput,
  PullRequestThreadResolutionInput,
  PullRequestUnavailableError,
  PullRequestUpdateInput,
} from "./pullRequest.ts";
import {
  RelayClientInstallFailedError,
  RelayClientInstallProgressEventSchema,
  RelayClientStatusSchema,
} from "./relayClient.ts";
import {
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationGetWorkflowScriptError,
  OrchestrationV2GetNativeChildWorkError,
  OrchestrationV2StopWorkflowError,
  OrchestrationV2ForceStopThreadError,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2CommandOutputError,
  OrchestrationV2GetThreadProjectionError,
  OrchestrationV2RpcSchemas,
  OrchestrationV2ThreadLaunchError,
} from "./orchestrationV2.ts";
import {
  ProjectCreateNewInput,
  ProjectCreateNewResult,
  ProjectCreateFromThreadInput,
  ProjectCreateFromThreadResult,
  ProjectEnsureScratchResult,
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectListIgnoredFilesInput,
  ProjectListIgnoredFilesResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchContentsError,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  TerminalAttachInput,
  TerminalObserveInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  DiscoveredLocalServerList,
  ConfiguredLocalServerUrls,
  PreviewCloseInput,
  PreviewError,
  PreviewEvent,
  PreviewListInput,
  PreviewListResult,
  PreviewClearProfileError,
  PreviewClearProfileInput,
  PreviewReportProfilesInput,
  PreviewStopLocalServerError,
  PreviewStopLocalServerInput,
  PreviewOpenInput,
  PreviewReportStatusInput,
  PreviewResizeInput,
  PreviewAdjustInput,
  PreviewSessionSnapshot,
} from "./preview.ts";
import {
  DeviceActionInput,
  DeviceCloseInput,
  DeviceConfigureInput,
  DeviceDetail,
  DeviceDetailInput,
  DeviceError,
  DeviceListInput,
  SshDeviceHostConfig,
  DeviceEasAccount,
  DeviceEasAccountError,
  DeviceEasAccountInput,
  DeviceSimlockIdentity,
  DeviceSimlockIdentityError,
  DeviceSimlockIdentityInput,
  DeviceHostSummary,
  DeviceOpenInput,
  DeviceServiceState,
  DeviceSession,
  DeviceShutdownInput,
} from "./device.ts";
import {
  ServerConfigStreamEvent,
  DesktopUpdateCommitInput,
  OtlpEndpointCheckInput,
  ServerPrepareTriageError,
  ServerPrepareTriageInput,
  ServerPrepareTriageResult,
  OtlpEndpointCheckResult,
  ServerConfig,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerSelfUpdateError,
  ServerNpmRelease,
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  ServerSelfUpdateInput,
  ServerSelfUpdateProgressEvent,
  ServerSelfUpdateResult,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import {
  HostResourcesSnapshot,
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryInput,
  ResourceTelemetryRetryResult,
  ResourceTelemetrySnapshot,
} from "./resourceTelemetry.ts";
import {
  UsageLimitSourceError,
  ProviderConsumeResetCreditInput,
  ProviderConsumeResetCreditResult,
} from "./providerUsageLimits.ts";
import { UsagePricing, UsageReadError, UsageSummary, UsageSummaryInput } from "./usage.ts";
import {
  StorageCleanupReport,
  DatabaseReclaimError,
  DatabaseStorageStatus,
  ServerSettings,
  ServerSettingsError,
  ClientServerSettingsPatch,
  ListTextGeneratorModelsInput,
  ListTextGeneratorModelsResult,
  TextGeneratorError,
} from "./settings.ts";
import {
  ScheduledTaskDeleteInput,
  ScheduledTaskDeleteResult,
  ScheduledTaskError,
  ScheduledTaskListInput,
  ScheduledTaskListResult,
  ScheduledTaskRunNowInput,
  ScheduledTaskRotateWebhookTokenInput,
  ScheduledTaskListWebhookDeliveriesInput,
  ScheduledTaskListWebhookDeliveriesResult,
  ScheduledTaskGetWebhookDeliveryInput,
  ScheduledTaskGetWebhookDeliveryResult,
  ScheduledTaskRunNowResult,
  ScheduledTaskSetEnabledInput,
  ScheduledTaskUpsertInput,
  ScheduledTaskMutationResult,
} from "./scheduledTask.ts";
import { SecretRequestAnswerInput, SecretRequestError } from "./secretRequest.ts";
import {
  ProjectCloneActionInput,
  ProjectCloneActionResult,
  ProjectCloneListEvent,
  ProjectCloneStartInput,
  ProjectCloneStartResult,
  ProjectCloneSubscribeInput,
} from "./projectClone.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
  SourceControlAppAccess,
  SourceControlAppAccessInput,
  SourceControlStarredInput,
  SourceControlSignInError,
  SourceControlSignInInput,
  SourceControlSignInPrompt,
  SourceControlSignInResult,
} from "./sourceControl.ts";
import { VcsError } from "./vcs.ts";
import { Project, ProjectMutation, ProjectMutationError } from "./project.ts";

export const WS_METHODS = {
  projectsListEntries: "projects.listEntries",
  projectsListIgnoredFiles: "projects.listIgnoredFiles",
  projectsReadFile: "projects.readFile",
  projectsSearchContents: "projects.searchContents",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",
  projectsMutate: "projects.mutate",
  projectsEnsureScratch: "projects.ensureScratch",
  projectsCreateNew: "projects.createNew",
  projectsCreateFromThread: "projects.createFromThread",

  shellOpenInEditor: "shell.openInEditor",

  filesystemBrowse: "filesystem.browse",
  filesystemGetMetadata: "filesystem.getMetadata",
  agentSessionsScan: "agentSessions.scan",
  agentSessionsImport: "agentSessions.import",
  assetsCreateUrl: "assets.createUrl",
  assetsPersistChatAttachments: "assets.persistChatAttachments",
  attachmentsCreateUploadUrl: "attachments.createUploadUrl",
  attachmentsDelete: "attachments.delete",

  mcpAppsCallTool: "mcpApps.callTool",
  mcpAppsToolInfo: "mcpApps.toolInfo",
  mcpAppsReadResource: "mcpApps.readResource",
  mcpAppsUpdateModelContext: "mcpApps.updateModelContext",

  providerUploadFeedback: "provider.uploadFeedback",
  providerAuthStart: "provider.auth.start",
  providerConsumeResetCredit: "provider.consumeResetCredit",
  providerAuthComplete: "provider.auth.complete",
  chatGptReconnectProfile: "provider.chatgpt.reconnect-profile",
  chatGptImportProfile: "provider.chatgpt.import-profile",
  chatGptHandoffSubscribe: "provider.chatgpt.handoff.subscribe",
  providerAuthRespond: "provider.auth.respond",
  providerAuthCancel: "provider.auth.cancel",
  providerAuthRemoveMethod: "provider.auth.removeMethod",
  providerAuthLogout: "provider.auth.logout",
  providerAuthSubscribe: "provider.auth.subscribe",
  claudeSignInStart: "provider.claude.signIn.start",
  claudeSignInSubmit: "provider.claude.signIn.submit",
  claudeSignInCancel: "provider.claude.signIn.cancel",
  providerInstallStart: "provider.install.start",
  providerInstallCancel: "provider.install.cancel",
  providerInstallSubscribe: "provider.install.subscribe",
  providerInstallRemove: "provider.install.remove",

  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  reviewGetBranchCommits: "review.getBranchCommits",
  reviewGetDiffPreview: "review.getDiffPreview",
  reviewGetDiffFileContents: "review.getDiffFileContents",

  terminalOpen: "terminal.open",
  terminalAttach: "terminal.attach",
  terminalObserve: "terminal.observe",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalClose: "terminal.close",

  previewOpen: "preview.open",
  previewResize: "preview.resize",
  previewAdjust: "preview.adjust",
  previewClose: "preview.close",
  previewList: "preview.list",
  previewClearProfile: "preview.clearProfile",
  previewReportProfiles: "preview.reportProfiles",
  previewReportStatus: "preview.reportStatus",
  previewStopLocalServer: "preview.stopLocalServer",

  deviceConfigure: "device.configure",
  deviceList: "device.list",
  deviceTestHost: "device.testHost",
  deviceEasAccount: "device.easAccount",
  deviceSimlockIdentity: "device.simlockIdentity",
  deviceOpen: "device.open",
  deviceClose: "device.close",
  deviceShutdown: "device.shutdown",
  deviceDetail: "device.detail",
  deviceAction: "device.action",

  serverProbe: "server.probe",
  serverGetConfig: "server.getConfig",
  serverGetNpmRelease: "server.getNpmRelease",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverUpdateServer: "server.updateServer",
  serverUpdateServerWithProgress: "server.updateServerWithProgress",
  serverCommitDesktopUpdate: "server.commitDesktopUpdate",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverRunStorageCleanup: "server.runStorageCleanup",
  serverGetStorageCleanupReport: "server.getStorageCleanupReport",
  serverGetDatabaseStorage: "server.getDatabaseStorage",
  serverReclaimDatabaseSpace: "server.reclaimDatabaseSpace",
  peerLinksList: "peerLinks.list",
  peerLinksLink: "peerLinks.link",
  peerLinksUnlink: "peerLinks.unlink",
  peerLinksAnswerRequest: "peerLinks.answerRequest",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverCheckSecretSource: "server.checkSecretSource",
  serverSearchAcpRegistry: "server.searchAcpRegistry",
  serverPrepareAcpRegistryAgent: "server.prepareAcpRegistryAgent",
  serverUninstallAcpRegistryManagedBinary: "server.uninstallAcpRegistryManagedBinary",
  serverAcceptAcpRegistryUrlAuth: "server.acceptAcpRegistryUrlAuth",
  serverListAcpRegistrySessions: "server.listAcpRegistrySessions",
  serverImportAcpRegistrySession: "server.importAcpRegistrySession",
  serverDeleteAcpRegistrySession: "server.deleteAcpRegistrySession",
  serverListAcpRegistryProviders: "server.listAcpRegistryProviders",
  serverSetAcpRegistryProvider: "server.setAcpRegistryProvider",
  serverDisableAcpRegistryProvider: "server.disableAcpRegistryProvider",
  serverLogoutAcpRegistry: "server.logoutAcpRegistry",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetHostResources: "server.getHostResources",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetResourceTelemetryHistory: "server.getResourceTelemetryHistory",
  serverRetryResourceTelemetry: "server.retryResourceTelemetry",
  serverCheckOtlpEndpoint: "server.checkOtlpEndpoint",
  serverListTextGeneratorModels: "server.listTextGeneratorModels",
  serverPrepareTriage: "server.prepareTriage",
  serverSignalProcess: "server.signalProcess",
  serverReportClientActivity: "server.reportClientActivity",
  serverGetUsageSummary: "server.getUsageSummary",
  serverRefreshUsageRates: "server.refreshUsageRates",

  scheduledTasksSubscribe: "scheduledTasks.subscribe",
  scheduledTasksUpsert: "scheduledTasks.upsert",
  scheduledTasksSetEnabled: "scheduledTasks.setEnabled",
  scheduledTasksDelete: "scheduledTasks.delete",
  scheduledTasksRunNow: "scheduledTasks.runNow",
  scheduledTasksRotateWebhookToken: "scheduledTasks.rotateWebhookToken",
  secretsAnswerRequest: "secrets.answerRequest",
  guestShareCreate: "guestShare.create",
  scheduledTasksListWebhookDeliveries: "scheduledTasks.listWebhookDeliveries",
  scheduledTasksGetWebhookDelivery: "scheduledTasks.getWebhookDelivery",

  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",

  pullRequestsList: "pullRequests.list",
  pullRequestsListStats: "pullRequests.listStats",
  pullRequestsFilterOptions: "pullRequests.filterOptions",
  pullRequestsSummary: "pullRequests.summary",
  pullRequestsRouting: "pullRequests.routing",
  pullRequestsRoutingIdentity: "pullRequests.routingIdentity",
  pullRequestsStack: "pullRequests.stack",
  pullRequestsLinkedThreads: "pullRequests.linkedThreads",
  pullRequestsDetail: "pullRequests.detail",
  pullRequestsPreview: "pullRequests.preview",
  pullRequestsChecks: "pullRequests.checks",
  pullRequestsActivity: "pullRequests.activity",
  pullRequestsReviewGuide: "pullRequests.reviewGuide",
  pullRequestsGenerateReviewGuide: "pullRequests.generateReviewGuide",
  pullRequestsThreadComments: "pullRequests.threadComments",
  pullRequestsDiffFileContents: "pullRequests.diffFileContents",
  pullRequestsFilesViewed: "pullRequests.filesViewed",
  pullRequestsChangeBreakdown: "pullRequests.changeBreakdown",
  pullRequestsSetFilesViewed: "pullRequests.setFilesViewed",
  pullRequestsRunAction: "pullRequests.runAction",
  pullRequestsUpdate: "pullRequests.update",
  pullRequestsComment: "pullRequests.comment",
  pullRequestsUpdateComment: "pullRequests.updateComment",
  pullRequestsSubmitReview: "pullRequests.submitReview",
  pullRequestsReplyToThread: "pullRequests.replyToThread",
  pullRequestsSetThreadResolution: "pullRequests.setThreadResolution",
  pullRequestsSetReaction: "pullRequests.setReaction",
  pullRequestsInvalidate: "pullRequests.invalidate",
  pullRequestsReportState: "pullRequests.reportState",
  pullRequestsSubscribeRefreshes: "pullRequests.subscribeRefreshes",
  pullRequestsSubscribeLinkedThreadRefreshes: "pullRequests.subscribeLinkedThreadRefreshes",
  pullRequestsReviewerCandidates: "pullRequests.reviewerCandidates",
  pullRequestsRequestReviewers: "pullRequests.requestReviewers",
  pullRequestsLabelCandidates: "pullRequests.labelCandidates",
  pullRequestsSetLabels: "pullRequests.setLabels",

  // Issue tracking methods
  issuesList: "issues.list",
  issuesDetail: "issues.detail",
  issuesComments: "issues.comments",
  issuesTemplates: "issues.templates",
  issuesCandidates: "issues.candidates",
  issuesCreate: "issues.create",
  issuesComment: "issues.comment",
  issuesUpdate: "issues.update",
  issuesSetState: "issues.setState",
  issuesReact: "issues.react",
  issuesLinkedThreads: "issues.linkedThreads",
  issueTrackersList: "issueTrackers.list",
  issueTrackersConnect: "issueTrackers.connect",
  issueTrackersBindProject: "issueTrackers.bindProject",

  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",
  sourceControlSignInStart: "sourceControl.signInStart",
  sourceControlSignInWait: "sourceControl.signInWait",
  sourceControlSignInCancel: "sourceControl.signInCancel",
  sourceControlAppAccess: "sourceControl.appAccess",
  sourceControlStarred: "sourceControl.starred",
  sourceControlStar: "sourceControl.star",
  projectCloneStart: "projectClone.start",
  projectCloneCancel: "projectClone.cancel",
  projectCloneRetry: "projectClone.retry",
  subscribeProjectClones: "subscribeProjectClones",

  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeVcsBranch: "subscribeVcsBranch",
  vcsRefreshBranch: "vcs.refreshBranch",
  subscribeWorktreeSetup: "subscribeWorktreeSetup",
  worktreeSetupCancel: "worktreeSetup.cancel",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribePreviewEvents: "subscribePreviewEvents",
  subscribeDiscoveredLocalServers: "subscribeDiscoveredLocalServers",
  subscribeDeviceState: "subscribeDeviceState",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeResourceTelemetry: "subscribeResourceTelemetry",

  majordomeGetPushConfig: "majordome.getPushConfig",
  majordomeSavePushSubscription: "majordome.savePushSubscription",
  majordomeRemovePushSubscription: "majordome.removePushSubscription",
  majordomeSendTestPush: "majordome.sendTestPush",
  majordomeListPushDevices: "majordome.listPushDevices",
  majordomeGetPhoneSetup: "majordome.getPhoneSetup",
  majordomeEnableSecureAddress: "majordome.enableSecureAddress",
  majordomeEnableAnywhereAddress: "majordome.enableAnywhereAddress",
  majordomeDisableAnywhereAddress: "majordome.disableAnywhereAddress",
  majordomeListVaultHistory: "majordome.listVaultHistory",
  majordomeSubscribeVaultChanges: "majordome.subscribeVaultChanges",
  majordomeUndoVaultRun: "majordome.undoVaultRun",
  majordomeRunRoutinesHere: "majordome.runRoutinesHere",
  majordomeListReadyRoutines: "majordome.listReadyRoutines",
  majordomeAddReadyRoutine: "majordome.addReadyRoutine",
  majordomeSetRoutineLimits: "majordome.setRoutineLimits",
  majordomeStartNotes: "majordome.startNotes",
  majordomeGetBackupStatus: "majordome.getBackupStatus",
  majordomeListConnectors: "majordome.listConnectors",
  majordomeSearchNotes: "majordome.searchNotes",
  majordomeGetNotesIndexStatus: "majordome.getNotesIndexStatus",
  majordomeRebuildNotesIndex: "majordome.rebuildNotesIndex",
  majordomeListPrivateDocuments: "majordome.listPrivateDocuments",
  majordomeAddPrivateDocument: "majordome.addPrivateDocument",
  majordomeRemovePrivateDocument: "majordome.removePrivateDocument",
  majordomeViewPrivateDocument: "majordome.viewPrivateDocument",
  majordomeGetPrivateDocumentRequest: "majordome.getPrivateDocumentRequest",
  majordomeAnswerPrivateDocumentRequest: "majordome.answerPrivateDocumentRequest",
  majordomeGetApproval: "majordome.getApproval",
  majordomeAnswerApproval: "majordome.answerApproval",
  majordomeBackUpNow: "majordome.backUpNow",
  majordomeConfigureBackup: "majordome.configureBackup",
  majordomeLinkPeer: "majordome.linkPeer",
  majordomeUnlinkPeer: "majordome.unlinkPeer",
  majordomeConnectGitHubStart: "majordome.connectGitHubStart",
  majordomeConnectGitHubWait: "majordome.connectGitHubWait",
  majordomeConnectGitHubCancel: "majordome.connectGitHubCancel",
  majordomeConnectGoogleDriveStart: "majordome.connectGoogleDriveStart",
  majordomeConnectGoogleDriveWait: "majordome.connectGoogleDriveWait",
  majordomeConnectGoogleDriveCancel: "majordome.connectGoogleDriveCancel",
  majordomeListTopics: "majordome.listTopics",
  majordomeCreateTopic: "majordome.createTopic",
  majordomeSuggestTopicFolder: "majordome.suggestTopicFolder",
  majordomeUpdateTopic: "majordome.updateTopic",
  majordomeReorderTopics: "majordome.reorderTopics",
  majordomeRemoveTopic: "majordome.removeTopic",
  majordomeOpenTopic: "majordome.openTopic",
  majordomeSetThreadTopic: "majordome.setThreadTopic",
  majordomeOpenRoutinesConversation: "majordome.openRoutinesConversation",
  majordomeDismissTopicSuggestions: "majordome.dismissTopicSuggestions",
  majordomeListReadingItems: "majordome.listReadingItems",
  majordomeAddReadingItem: "majordome.addReadingItem",
  majordomeUpdateReadingItem: "majordome.updateReadingItem",
  majordomeReorderReadingItems: "majordome.reorderReadingItems",
  majordomeRemoveReadingItem: "majordome.removeReadingItem",
  majordomeRestoreReadingItem: "majordome.restoreReadingItem",
  majordomeSaveReadingSubjects: "majordome.saveReadingSubjects",
  majordomeListTodos: "majordome.listTodos",
  majordomeSetTodoDone: "majordome.setTodoDone",
  majordomeAddTodo: "majordome.addTodo",
  majordomeGetDailyNote: "majordome.getDailyNote",
  majordomeSaveDailyNote: "majordome.saveDailyNote",
  majordomeSaveNote: "majordome.saveNote",
  majordomeAddToDailyNote: "majordome.addToDailyNote",
  majordomeListTopicFiles: "majordome.listTopicFiles",
  majordomeGetKeyFacts: "majordome.getKeyFacts",
  majordomeDrawConversation: "majordome.drawConversation",
  majordomeAddTopicFile: "majordome.addTopicFile",
  majordomeRemoveTopicFile: "majordome.removeTopicFile",
  majordomeViewTopicFile: "majordome.viewTopicFile",
  majordomeServerMoveSubscribe: "majordome.serverMove.subscribe",
  majordomeServerMoveSaveKeys: "majordome.serverMove.saveKeys",
  majordomeServerMoveForgetKeys: "majordome.serverMove.forgetKeys",
  majordomeServerMoveCheck: "majordome.serverMove.check",
  majordomeServerMoveStart: "majordome.serverMove.start",
  majordomeServerMoveRetry: "majordome.serverMove.retry",
  majordomeServerMoveCancel: "majordome.serverMove.cancel",
  majordomeServerMoveIssuePairingLink: "majordome.serverMove.issuePairingLink",
  majordomeServerMoveRoutines: "majordome.serverMove.moveRoutines",
  majordomeServerMoveRemove: "majordome.serverMove.remove",
} as const;

const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    instanceId: Schema.optional(ProviderInstanceId),
    cwd: Schema.optional(TrimmedNonEmptyString),
    fresh: Schema.optional(Schema.Boolean),
    /** Bypass model caches; explicit rediscovery may open sessions, background refreshes must not. */
    refreshModels: Schema.optional(Schema.Boolean),
    /**
     * A model picker opened: refetch a model manifest older than a few minutes and probe providers
     * only when it changed. The other fields are ignored and the config stream carries the result.
     */
    modelCatalogOnly: Schema.optional(Schema.Boolean),
    /** Read secret references again; unlocking a vault can prompt on the host, so only explicit user refreshes ask. */
    reloadSecrets: Schema.optional(Schema.Boolean),
    /**
     * Reply without snapshots, or with only the requested instance's cwd snapshot. Snapshots then
     * reach the client only through these replies, so another client's scan shows on its next
     * refresh, at most one TTL later.
     */
    workspaceSnapshotsOnDemand: Schema.optional(Schema.Boolean),
    /** As on `subscribeServerConfig`: add /usage-limits to the replied snapshot. */
    usageLimitsCommand: Schema.optional(Schema.Boolean),
    /** As on `subscribeServerConfig`: a failed cwd scan replies with the machine catalog as a pending snapshot. */
    providerCatalogsOnDemand: Schema.optional(Schema.Boolean),
    /**
     * Reply with no providers; the config stream carries the result. For callers that only wait
     * for the refresh. Ignored with `instanceId` and `cwd`, whose reply is the snapshot.
     */
    omitProviders: Schema.optional(Schema.Boolean),
    /**
     * With `providerCatalogsOnDemand`, a cwd reply also carries the machine slash command names
     * and skills with their `catalogDigest`. Sent by a client whose held lists are not current.
     */
    machineCatalog: Schema.optional(Schema.Boolean),
  }),
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([EnvironmentAuthorizationError, ProviderSetupError]),
});

const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([ServerProviderUpdateError, EnvironmentAuthorizationError]),
});

const ProviderSetupRpcError = Schema.Union([ProviderSetupError, EnvironmentAuthorizationError]);

const WsProviderConsumeResetCreditRpc = Rpc.make(WS_METHODS.providerConsumeResetCredit, {
  payload: ProviderConsumeResetCreditInput,
  success: ProviderConsumeResetCreditResult,
  error: Schema.Union([ProviderSetupError, UsageLimitSourceError, EnvironmentAuthorizationError]),
});

const WsProviderAuthStartRpc = Rpc.make(WS_METHODS.providerAuthStart, {
  payload: ProviderAuthStartInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthRespondRpc = Rpc.make(WS_METHODS.providerAuthRespond, {
  payload: ProviderAuthRespondInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthCompleteRpc = Rpc.make(WS_METHODS.providerAuthComplete, {
  payload: ProviderAuthCompleteInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsChatGptReconnectProfileRpc = Rpc.make(WS_METHODS.chatGptReconnectProfile, {
  payload: ChatGptReconnectProfileInput,
  success: Schema.NullOr(ChatGptReconnectProfile),
  error: ProviderSetupRpcError,
});
const WsChatGptImportProfileRpc = Rpc.make(WS_METHODS.chatGptImportProfile, {
  payload: ChatGptImportProfileInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});
const WsChatGptHandoffSubscribeRpc = Rpc.make(WS_METHODS.chatGptHandoffSubscribe, {
  payload: ChatGptHandoffInput,
  success: ChatGptHandoffState,
  error: ProviderSetupRpcError,
  stream: true,
});

const WsProviderAuthCancelRpc = Rpc.make(WS_METHODS.providerAuthCancel, {
  payload: ProviderAuthCancelInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthRemoveMethodRpc = Rpc.make(WS_METHODS.providerAuthRemoveMethod, {
  payload: ProviderAuthRemoveMethodInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthLogoutRpc = Rpc.make(WS_METHODS.providerAuthLogout, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthSubscribeRpc = Rpc.make(WS_METHODS.providerAuthSubscribe, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
  stream: true,
});

const ClaudeSignInRpcError = Schema.Union([ClaudeSignInError, EnvironmentAuthorizationError]);

const WsClaudeSignInStartRpc = Rpc.make(WS_METHODS.claudeSignInStart, {
  payload: ProviderSetupInput,
  success: ClaudeSignInAttempt,
  error: ClaudeSignInRpcError,
});

const WsClaudeSignInSubmitRpc = Rpc.make(WS_METHODS.claudeSignInSubmit, {
  payload: ClaudeSignInSubmitInput,
  success: ClaudeSignInResult,
  error: ClaudeSignInRpcError,
});

const WsClaudeSignInCancelRpc = Rpc.make(WS_METHODS.claudeSignInCancel, {
  payload: ClaudeSignInCancelInput,
  error: ClaudeSignInRpcError,
});

const WsProviderInstallStartRpc = Rpc.make(WS_METHODS.providerInstallStart, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsProviderInstallCancelRpc = Rpc.make(WS_METHODS.providerInstallCancel, {
  payload: ProviderInstallCancelInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsProviderInstallSubscribeRpc = Rpc.make(WS_METHODS.providerInstallSubscribe, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
  stream: true,
});

const WsProviderInstallRemoveRpc = Rpc.make(WS_METHODS.providerInstallRemove, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsServerGetNpmReleaseRpc = Rpc.make(WS_METHODS.serverGetNpmRelease, {
  payload: ServerNpmReleaseInput,
  success: Schema.NullOr(ServerNpmRelease),
  error: Schema.Union([ServerNpmReleaseError, EnvironmentAuthorizationError]),
});

const WsServerUpdateServerRpc = Rpc.make(WS_METHODS.serverUpdateServer, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

const WsServerUpdateServerWithProgressRpc = Rpc.make(WS_METHODS.serverUpdateServerWithProgress, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateProgressEvent,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsServerCommitDesktopUpdateRpc = Rpc.make(WS_METHODS.serverCommitDesktopUpdate, {
  payload: DesktopUpdateCommitInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

const WsServerRunStorageCleanupRpc = Rpc.make(WS_METHODS.serverRunStorageCleanup, {
  payload: Schema.Struct({}),
  success: StorageCleanupReport,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});
const WsServerGetStorageCleanupReportRpc = Rpc.make(WS_METHODS.serverGetStorageCleanupReport, {
  payload: Schema.Struct({}),
  success: Schema.NullOr(StorageCleanupReport),
  stream: true,
  error: EnvironmentAuthorizationError,
});

const WsServerGetDatabaseStorageRpc = Rpc.make(WS_METHODS.serverGetDatabaseStorage, {
  payload: Schema.Struct({}),
  success: Schema.NullOr(DatabaseStorageStatus),
  stream: true,
  error: EnvironmentAuthorizationError,
});

const WsServerReclaimDatabaseSpaceRpc = Rpc.make(WS_METHODS.serverReclaimDatabaseSpace, {
  payload: Schema.Struct({}),
  error: Schema.Union([DatabaseReclaimError, EnvironmentAuthorizationError]),
});

const WsPeerLinksListRpc = Rpc.make(WS_METHODS.peerLinksList, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ links: Schema.Array(PeerLinkSummary) }),
  error: Schema.Union([PeerLinkError, EnvironmentAuthorizationError]),
});

const WsPeerLinksLinkRpc = Rpc.make(WS_METHODS.peerLinksLink, {
  payload: PeerLinkCreateInput,
  success: PeerLink,
  error: Schema.Union([PeerLinkError, EnvironmentAuthorizationError]),
});

const WsPeerLinksUnlinkRpc = Rpc.make(WS_METHODS.peerLinksUnlink, {
  payload: PeerLinkRemoveInput,
  success: PeerLinkRemoveResult,
  error: Schema.Union([PeerLinkError, EnvironmentAuthorizationError]),
});

const WsPeerLinksAnswerRequestRpc = Rpc.make(WS_METHODS.peerLinksAnswerRequest, {
  payload: PeerLinkRequestAnswerInput,
  error: Schema.Union([PeerLinkRequestError, EnvironmentAuthorizationError]),
});

// No in-tree caller; installed Swift TestFlight builds still request it.
const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({
    patch: ClientServerSettingsPatch,
    providerInstanceMutation: Schema.optionalKey(ProviderInstanceMutation),
  }),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerCheckSecretSourceRpc = Rpc.make(WS_METHODS.serverCheckSecretSource, {
  payload: Schema.Struct({ source: SecretReference }),
  success: SecretSourceCheckResult,
  error: EnvironmentAuthorizationError,
});

const WsServerSearchAcpRegistryRpc = Rpc.make(WS_METHODS.serverSearchAcpRegistry, {
  payload: AcpRegistrySearchInput,
  success: AcpRegistrySearchResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerPrepareAcpRegistryAgentRpc = Rpc.make(WS_METHODS.serverPrepareAcpRegistryAgent, {
  payload: AcpRegistryPrepareInput,
  success: AcpRegistryPrepareResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerUninstallAcpRegistryManagedBinaryRpc = Rpc.make(
  WS_METHODS.serverUninstallAcpRegistryManagedBinary,
  {
    payload: AcpRegistryManagedBinaryUninstallInput,
    success: AcpRegistryManagedBinaryUninstallResult,
    error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
  },
);

const WsServerAcceptAcpRegistryUrlAuthRpc = Rpc.make(WS_METHODS.serverAcceptAcpRegistryUrlAuth, {
  payload: AcpRegistryAcceptUrlAuthInput,
  success: AcpRegistryAcceptUrlAuthResult,
  error: EnvironmentAuthorizationError,
});

const WsServerListAcpRegistrySessionsRpc = Rpc.make(WS_METHODS.serverListAcpRegistrySessions, {
  payload: AcpRegistryListSessionsInput,
  success: AcpRegistryListSessionsResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerImportAcpRegistrySessionRpc = Rpc.make(WS_METHODS.serverImportAcpRegistrySession, {
  payload: AcpRegistryImportSessionInput,
  success: AcpRegistryImportSessionResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerDeleteAcpRegistrySessionRpc = Rpc.make(WS_METHODS.serverDeleteAcpRegistrySession, {
  payload: AcpRegistryDeleteSessionInput,
  success: AcpRegistryDeleteSessionResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerListAcpRegistryProvidersRpc = Rpc.make(WS_METHODS.serverListAcpRegistryProviders, {
  payload: AcpRegistryListProvidersInput,
  success: AcpRegistryListProvidersResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerSetAcpRegistryProviderRpc = Rpc.make(WS_METHODS.serverSetAcpRegistryProvider, {
  payload: AcpRegistrySetProviderInput,
  success: AcpRegistrySetProviderResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerDisableAcpRegistryProviderRpc = Rpc.make(
  WS_METHODS.serverDisableAcpRegistryProvider,
  {
    payload: AcpRegistryDisableProviderInput,
    success: AcpRegistryDisableProviderResult,
    error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
  },
);

const WsServerLogoutAcpRegistryRpc = Rpc.make(WS_METHODS.serverLogoutAcpRegistry, {
  payload: AcpRegistryLogoutInput,
  success: AcpRegistryLogoutResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetHostResourcesRpc = Rpc.make(WS_METHODS.serverGetHostResources, {
  payload: Schema.Struct({}),
  success: HostResourcesSnapshot,
  error: EnvironmentAuthorizationError,
});

const WsServerGetProcessResourceHistoryRpc = Rpc.make(WS_METHODS.serverGetProcessResourceHistory, {
  payload: ServerProcessResourceHistoryInput,
  success: ServerProcessResourceHistoryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetResourceTelemetryHistoryRpc = Rpc.make(
  WS_METHODS.serverGetResourceTelemetryHistory,
  {
    payload: ResourceTelemetryHistoryInput,
    success: ResourceTelemetryHistory,
    error: EnvironmentAuthorizationError,
  },
);

const WsServerRetryResourceTelemetryRpc = Rpc.make(WS_METHODS.serverRetryResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetryRetryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerCheckOtlpEndpointRpc = Rpc.make(WS_METHODS.serverCheckOtlpEndpoint, {
  payload: OtlpEndpointCheckInput,
  success: OtlpEndpointCheckResult,
  error: EnvironmentAuthorizationError,
});

const WsServerListTextGeneratorModelsRpc = Rpc.make(WS_METHODS.serverListTextGeneratorModels, {
  payload: ListTextGeneratorModelsInput,
  success: ListTextGeneratorModelsResult,
  error: Schema.Union([TextGeneratorError, EnvironmentAuthorizationError]),
});

const WsServerPrepareTriageRpc = Rpc.make(WS_METHODS.serverPrepareTriage, {
  payload: ServerPrepareTriageInput,
  success: ServerPrepareTriageResult,
  error: Schema.Union([ServerPrepareTriageError, EnvironmentAuthorizationError]),
});

const WsServerGetUsageSummaryRpc = Rpc.make(WS_METHODS.serverGetUsageSummary, {
  payload: UsageSummaryInput,
  success: UsageSummary,
  error: Schema.Union([EnvironmentAuthorizationError, UsageReadError]),
});

const WsServerRefreshUsageRatesRpc = Rpc.make(WS_METHODS.serverRefreshUsageRates, {
  payload: Schema.Struct({}),
  success: UsagePricing,
  error: EnvironmentAuthorizationError,
});

const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
  error: EnvironmentAuthorizationError,
});

const WsCloudGetRelayClientStatusRpc = Rpc.make(WS_METHODS.cloudGetRelayClientStatus, {
  payload: Schema.Struct({}),
  success: RelayClientStatusSchema,
  error: EnvironmentAuthorizationError,
});

const WsCloudInstallRelayClientRpc = Rpc.make(WS_METHODS.cloudInstallRelayClient, {
  payload: Schema.Struct({}),
  success: RelayClientInstallProgressEventSchema,
  error: Schema.Union([RelayClientInstallFailedError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsServerReportClientActivityRpc = Rpc.make(WS_METHODS.serverReportClientActivity, {
  payload: ClientActivityReportInput,
  error: EnvironmentAuthorizationError,
});

const PullRequestRpcError = Schema.Union([
  PullRequestUnavailableError,
  PullRequestOperationError,
  EnvironmentAuthorizationError,
]);

const WsPullRequestsListRpc = Rpc.make(WS_METHODS.pullRequestsList, {
  payload: PullRequestListInput,
  success: PullRequestListResult,
  error: PullRequestRpcError,
});

// GitHub line counts cost 40-60% of the listing read; fetch separately so rows arrive first.
const WsPullRequestsListStatsRpc = Rpc.make(WS_METHODS.pullRequestsListStats, {
  payload: PullRequestListStatsInput,
  success: PullRequestListStatsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsFilterOptionsRpc = Rpc.make(WS_METHODS.pullRequestsFilterOptions, {
  payload: PullRequestFilterOptionsInput,
  success: PullRequestFilterOptions,
  error: PullRequestRpcError,
});

const WsPullRequestsRoutingRpc = Rpc.make(WS_METHODS.pullRequestsRouting, {
  payload: PullRequestRef,
  success: PullRequestRoutingResult,
  error: PullRequestRpcError,
});

const WsPullRequestsRoutingIdentityRpc = Rpc.make(WS_METHODS.pullRequestsRoutingIdentity, {
  payload: PullRequestRoutingIdentityInput,
  success: PullRequestRoutingIdentityResult,
  error: PullRequestRpcError,
});

const WsPullRequestsSummaryRpc = Rpc.make(WS_METHODS.pullRequestsSummary, {
  payload: PullRequestRef,
  success: PullRequestSummary,
  error: PullRequestRpcError,
});

const WsPullRequestsStackRpc = Rpc.make(WS_METHODS.pullRequestsStack, {
  payload: PullRequestRef,
  success: Schema.NullOr(PullRequestStack),
  error: PullRequestRpcError,
});

const WsPullRequestsLinkedThreadsRpc = Rpc.make(WS_METHODS.pullRequestsLinkedThreads, {
  payload: PullRequestRef,
  success: PullRequestLinkedThreadsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsDetailRpc = Rpc.make(WS_METHODS.pullRequestsDetail, {
  payload: PullRequestRef,
  success: PullRequestDetail,
  error: PullRequestRpcError,
});

const WsPullRequestsPreviewRpc = Rpc.make(WS_METHODS.pullRequestsPreview, {
  payload: PullRequestRef,
  success: PullRequestPreview,
  error: PullRequestRpcError,
});

const WsPullRequestsChecksRpc = Rpc.make(WS_METHODS.pullRequestsChecks, {
  payload: PullRequestRef,
  success: Schema.NullOr(PullRequestChecks),
  error: PullRequestRpcError,
});

const WsPullRequestsActivityRpc = Rpc.make(WS_METHODS.pullRequestsActivity, {
  payload: PullRequestRef,
  success: PullRequestActivity,
  error: PullRequestRpcError,
});

const WsPullRequestsReviewGuideRpc = Rpc.make(WS_METHODS.pullRequestsReviewGuide, {
  payload: PullRequestRef,
  success: PullRequestReviewGuideResult,
  error: PullRequestRpcError,
});

const WsPullRequestsGenerateReviewGuideRpc = Rpc.make(WS_METHODS.pullRequestsGenerateReviewGuide, {
  payload: PullRequestRef,
  success: PullRequestReviewGuideResult,
  error: PullRequestRpcError,
});

const WsPullRequestsThreadCommentsRpc = Rpc.make(WS_METHODS.pullRequestsThreadComments, {
  payload: PullRequestThreadCommentsInput,
  success: PullRequestThreadCommentsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsDiffFileContentsRpc = Rpc.make(WS_METHODS.pullRequestsDiffFileContents, {
  payload: PullRequestDiffFileContentsInput,
  success: PullRequestDiffFileContentsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsFilesViewedRpc = Rpc.make(WS_METHODS.pullRequestsFilesViewed, {
  payload: PullRequestRef,
  success: PullRequestFilesViewedResult,
  error: PullRequestRpcError,
});

const WsPullRequestsChangeBreakdownRpc = Rpc.make(WS_METHODS.pullRequestsChangeBreakdown, {
  payload: PullRequestRef,
  success: PullRequestChangeBreakdown,
  error: PullRequestRpcError,
});

const WsPullRequestsSetFilesViewedRpc = Rpc.make(WS_METHODS.pullRequestsSetFilesViewed, {
  payload: PullRequestSetFilesViewedInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsRunActionRpc = Rpc.make(WS_METHODS.pullRequestsRunAction, {
  payload: PullRequestActionInput,
  // Undefined unless asked for with replyWithSummary, or when the host's reply lacked it.
  success: Schema.UndefinedOr(PullRequestSummary),
  error: PullRequestRpcError,
});

const WsPullRequestsUpdateRpc = Rpc.make(WS_METHODS.pullRequestsUpdate, {
  payload: PullRequestUpdateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsCommentRpc = Rpc.make(WS_METHODS.pullRequestsComment, {
  payload: PullRequestCommentInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsUpdateCommentRpc = Rpc.make(WS_METHODS.pullRequestsUpdateComment, {
  payload: PullRequestCommentUpdateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSubmitReviewRpc = Rpc.make(WS_METHODS.pullRequestsSubmitReview, {
  payload: PullRequestSubmitReviewInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsReplyToThreadRpc = Rpc.make(WS_METHODS.pullRequestsReplyToThread, {
  payload: PullRequestThreadReplyInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSetThreadResolutionRpc = Rpc.make(WS_METHODS.pullRequestsSetThreadResolution, {
  payload: PullRequestThreadResolutionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSetReactionRpc = Rpc.make(WS_METHODS.pullRequestsSetReaction, {
  payload: PullRequestReactionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsInvalidateRpc = Rpc.make(WS_METHODS.pullRequestsInvalidate, {
  payload: PullRequestInvalidateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsReportStateRpc = Rpc.make(WS_METHODS.pullRequestsReportState, {
  payload: PullRequestReportStateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSubscribeRefreshesRpc = Rpc.make(WS_METHODS.pullRequestsSubscribeRefreshes, {
  payload: Schema.Struct({}),
  success: NonNegativeInt,
  error: EnvironmentAuthorizationError,
  stream: true,
});

// Separate from the refreshes above so linked-thread changes don't refetch forge-backed reads.
const WsPullRequestsSubscribeLinkedThreadRefreshesRpc = Rpc.make(
  WS_METHODS.pullRequestsSubscribeLinkedThreadRefreshes,
  {
    payload: Schema.Struct({}),
    success: NonNegativeInt,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

// Fetch reviewer candidates only when the menu opens to avoid unused host requests.
const WsPullRequestsReviewerCandidatesRpc = Rpc.make(WS_METHODS.pullRequestsReviewerCandidates, {
  payload: PullRequestReviewerCandidatesInput,
  success: PullRequestReviewerCandidateList,
  error: PullRequestRpcError,
});

const WsPullRequestsRequestReviewersRpc = Rpc.make(WS_METHODS.pullRequestsRequestReviewers, {
  payload: PullRequestReviewerRequestInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsLabelCandidatesRpc = Rpc.make(WS_METHODS.pullRequestsLabelCandidates, {
  payload: PullRequestRef,
  success: PullRequestLabelCandidateList,
  error: PullRequestRpcError,
});

const WsPullRequestsSetLabelsRpc = Rpc.make(WS_METHODS.pullRequestsSetLabels, {
  payload: PullRequestLabelChangeInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const IssueRpcError = Schema.Union([
  IssueUnavailableError,
  IssueOperationError,
  EnvironmentAuthorizationError,
]);

const WsIssuesListRpc = Rpc.make(WS_METHODS.issuesList, {
  payload: IssueListInput,
  success: IssueListResult,
  error: IssueRpcError,
});

const WsIssuesDetailRpc = Rpc.make(WS_METHODS.issuesDetail, {
  payload: IssueRef,
  success: IssueDetail,
  error: IssueRpcError,
});

/** Older comments, one page at a time, past the cursor the detail handed over. */
const WsIssuesLinkedThreadsRpc = Rpc.make(WS_METHODS.issuesLinkedThreads, {
  payload: ThreadIssueKey,
  success: IssueLinkedThreadsResult,
  error: IssueRpcError,
});

const WsIssuesCommentsRpc = Rpc.make(WS_METHODS.issuesComments, {
  payload: IssueCommentsPageInput,
  success: IssueCommentsPage,
  error: IssueRpcError,
});

const WsIssuesTemplatesRpc = Rpc.make(WS_METHODS.issuesTemplates, {
  payload: IssueScopeRef,
  success: IssueTemplateList,
  error: IssueRpcError,
});

/** Read when a label or assignee picker opens, not with every issue. */
const WsIssuesCandidatesRpc = Rpc.make(WS_METHODS.issuesCandidates, {
  payload: IssueScopeRef,
  success: IssueCandidates,
  error: IssueRpcError,
});

const WsIssuesCreateRpc = Rpc.make(WS_METHODS.issuesCreate, {
  payload: IssueCreateInput,
  success: IssueCreateResult,
  error: IssueRpcError,
});

const WsIssuesCommentRpc = Rpc.make(WS_METHODS.issuesComment, {
  payload: IssueCommentInput,
  success: Schema.Void,
  error: IssueRpcError,
});

const WsIssuesUpdateRpc = Rpc.make(WS_METHODS.issuesUpdate, {
  payload: IssueUpdateInput,
  success: Schema.Void,
  error: IssueRpcError,
});

const WsIssuesSetStateRpc = Rpc.make(WS_METHODS.issuesSetState, {
  payload: IssueSetStateInput,
  success: Schema.Void,
  error: IssueRpcError,
});

const WsIssuesReactRpc = Rpc.make(WS_METHODS.issuesReact, {
  payload: IssueReactionInput,
  success: Schema.Void,
  error: IssueRpcError,
});

const IssueTrackerRpcError = Schema.Union([
  IssueTrackerConnectionError,
  EnvironmentAuthorizationError,
]);

/** Every standalone tracker this server ships, each with its connection probed afresh. */
const WsIssueTrackersListRpc = Rpc.make(WS_METHODS.issueTrackersList, {
  payload: Schema.Struct({}),
  success: IssueTrackerConnectionList,
  error: IssueTrackerRpcError,
});

/**
 * Verifies the credential against the tracker before storing it; the result is the new status.
 * A null token disconnects, which also unbinds every project that pointed at the tracker.
 */
const WsIssueTrackersConnectRpc = Rpc.make(WS_METHODS.issueTrackersConnect, {
  payload: IssueTrackerConnectInput,
  success: IssueTrackerConnection,
  error: IssueTrackerRpcError,
});

const WsIssueTrackersBindProjectRpc = Rpc.make(WS_METHODS.issueTrackersBindProject, {
  payload: IssueTrackerBindProjectInput,
  success: Schema.Void,
  error: IssueTrackerRpcError,
});

const WsSourceControlLookupRepositoryRpc = Rpc.make(WS_METHODS.sourceControlLookupRepository, {
  payload: SourceControlRepositoryLookupInput,
  success: SourceControlRepositoryInfo,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

// Starts a device-flow sign-in the server finishes on its own, so a client can leave meanwhile.
const WsSourceControlSignInStartRpc = Rpc.make(WS_METHODS.sourceControlSignInStart, {
  payload: SourceControlSignInInput,
  success: SourceControlSignInPrompt,
  error: Schema.Union([SourceControlSignInError, EnvironmentAuthorizationError]),
});

// Resolves when the sign-in `signInStart` began ends, however long the user takes.
const WsSourceControlSignInWaitRpc = Rpc.make(WS_METHODS.sourceControlSignInWait, {
  payload: SourceControlSignInInput,
  success: SourceControlSignInResult,
  error: Schema.Union([SourceControlSignInError, EnvironmentAuthorizationError]),
});

// Ends the sign-in `signInStart` began, so approving the code afterwards signs nothing in.
const WsSourceControlSignInCancelRpc = Rpc.make(WS_METHODS.sourceControlSignInCancel, {
  payload: SourceControlSignInInput,
  success: Schema.Void,
  error: Schema.Union([SourceControlSignInError, EnvironmentAuthorizationError]),
});

const WsSourceControlAppAccessRpc = Rpc.make(WS_METHODS.sourceControlAppAccess, {
  payload: SourceControlAppAccessInput,
  success: SourceControlAppAccess,
  error: EnvironmentAuthorizationError,
});

// False when the server's forge account has not starred the repository or the forge cannot say.
const WsSourceControlStarredRpc = Rpc.make(WS_METHODS.sourceControlStarred, {
  payload: SourceControlStarredInput,
  success: Schema.Boolean,
  error: EnvironmentAuthorizationError,
});

// Stars the repository as the server's forge account. False when the forge refused or cannot star.
const WsSourceControlStarRpc = Rpc.make(WS_METHODS.sourceControlStar, {
  payload: SourceControlStarredInput,
  success: Schema.Boolean,
  error: EnvironmentAuthorizationError,
});

// Returns when the project exists and cloning starts; progress uses the subscription.
const WsProjectCloneStartRpc = Rpc.make(WS_METHODS.projectCloneStart, {
  payload: ProjectCloneStartInput,
  success: ProjectCloneStartResult,
  error: Schema.Union([
    SourceControlRepositoryError,
    OrchestrationDispatchCommandError,
    EnvironmentAuthorizationError,
  ]),
});

const WsProjectCloneCancelRpc = Rpc.make(WS_METHODS.projectCloneCancel, {
  payload: ProjectCloneActionInput,
  success: ProjectCloneActionResult,
  error: EnvironmentAuthorizationError,
});

const WsProjectCloneRetryRpc = Rpc.make(WS_METHODS.projectCloneRetry, {
  payload: ProjectCloneActionInput,
  success: ProjectCloneActionResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsSubscribeProjectClonesRpc = Rpc.make(WS_METHODS.subscribeProjectClones, {
  payload: ProjectCloneSubscribeInput,
  success: ProjectCloneListEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSourceControlPublishRepositoryRpc = Rpc.make(WS_METHODS.sourceControlPublishRepository, {
  payload: SourceControlPublishRepositoryInput,
  success: SourceControlPublishRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: Schema.Union([ProjectSearchEntriesError, EnvironmentAuthorizationError]),
});

const WsProjectsSearchContentsRpc = Rpc.make(WS_METHODS.projectsSearchContents, {
  payload: ProjectSearchContentsInput,
  success: ProjectSearchContentsResult,
  error: Schema.Union([ProjectSearchContentsError, EnvironmentAuthorizationError]),
});

const WsProjectsListEntriesRpc = Rpc.make(WS_METHODS.projectsListEntries, {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: Schema.Union([ProjectListEntriesError, EnvironmentAuthorizationError]),
});

const WsProjectsListIgnoredFilesRpc = Rpc.make(WS_METHODS.projectsListIgnoredFiles, {
  payload: ProjectListIgnoredFilesInput,
  success: ProjectListIgnoredFilesResult,
  error: Schema.Union([ProjectListEntriesError, EnvironmentAuthorizationError]),
});

const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: Schema.Union([ProjectReadFileError, EnvironmentAuthorizationError]),
});

const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: Schema.Union([ProjectWriteFileError, EnvironmentAuthorizationError]),
});

const WsProjectsMutateRpc = Rpc.make(WS_METHODS.projectsMutate, {
  payload: ProjectMutation,
  success: Project,
  error: Schema.Union([ProjectMutationError, EnvironmentAuthorizationError]),
});

const WsProjectsEnsureScratchRpc = Rpc.make(WS_METHODS.projectsEnsureScratch, {
  payload: Schema.Struct({}),
  success: ProjectEnsureScratchResult,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsProjectsCreateNewRpc = Rpc.make(WS_METHODS.projectsCreateNew, {
  payload: ProjectCreateNewInput,
  success: ProjectCreateNewResult,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsProjectsCreateFromThreadRpc = Rpc.make(WS_METHODS.projectsCreateFromThread, {
  payload: ProjectCreateFromThreadInput,
  success: ProjectCreateFromThreadResult,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: Schema.Union([ExternalLauncherError, EnvironmentAuthorizationError]),
});

const WsFilesystemGetMetadataRpc = Rpc.make(WS_METHODS.filesystemGetMetadata, {
  payload: FilesystemGetMetadataInput,
  success: FilesystemGetMetadataResult,
  error: EnvironmentAuthorizationError,
});

const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: Schema.Union([FilesystemBrowseError, EnvironmentAuthorizationError]),
});

const WsAgentSessionsScanRpc = Rpc.make(WS_METHODS.agentSessionsScan, {
  payload: AgentSessionScanInput,
  success: AgentSessionScanResult,
  error: Schema.Union([AgentSessionScanError, EnvironmentAuthorizationError]),
});

const WsAgentSessionsImportRpc = Rpc.make(WS_METHODS.agentSessionsImport, {
  payload: AgentSessionImportInput,
  success: AgentSessionImportResult,
  error: Schema.Union([
    AgentSessionImportProjectChangedError,
    AgentSessionImportProjectNotFoundError,
    AgentSessionScanError,
    EnvironmentAuthorizationError,
  ]),
});

const WsAssetsCreateUrlRpc = Rpc.make(WS_METHODS.assetsCreateUrl, {
  payload: AssetCreateUrlInput,
  success: AssetCreateUrlResult,
  error: Schema.Union([AssetAccessError, EnvironmentAuthorizationError]),
});

const WsAssetsPersistChatAttachmentsRpc = Rpc.make(WS_METHODS.assetsPersistChatAttachments, {
  payload: PersistChatAttachmentsInput,
  success: PersistChatAttachmentsResult,
  error: Schema.Union([PersistChatAttachmentsError, EnvironmentAuthorizationError]),
});

const WsAttachmentsCreateUploadUrlRpc = Rpc.make(WS_METHODS.attachmentsCreateUploadUrl, {
  payload: AttachmentCreateUploadUrlInput,
  success: AttachmentCreateUploadUrlResult,
  error: Schema.Union([AttachmentUploadSigningKeyError, EnvironmentAuthorizationError]),
});

const WsAttachmentsDeleteRpc = Rpc.make(WS_METHODS.attachmentsDelete, {
  payload: AttachmentDeleteInput,
  error: EnvironmentAuthorizationError,
});

const WsMcpAppsCallToolRpc = Rpc.make(WS_METHODS.mcpAppsCallTool, {
  payload: McpAppCallToolInput,
  success: McpAppCallToolResult,
  error: Schema.Union([McpAppRequestError, EnvironmentAuthorizationError]),
});

const WsMcpAppsToolInfoRpc = Rpc.make(WS_METHODS.mcpAppsToolInfo, {
  payload: McpAppToolInfoInput,
  success: McpAppToolInfo,
  error: Schema.Union([McpAppRequestError, EnvironmentAuthorizationError]),
});

const WsMcpAppsUpdateModelContextRpc = Rpc.make(WS_METHODS.mcpAppsUpdateModelContext, {
  payload: McpAppUpdateModelContextInput,
  error: Schema.Union([McpAppRequestError, EnvironmentAuthorizationError]),
});

const WsMcpAppsReadResourceRpc = Rpc.make(WS_METHODS.mcpAppsReadResource, {
  payload: McpAppReadResourceInput,
  success: McpAppReadResourceResult,
  error: Schema.Union([McpAppRequestError, EnvironmentAuthorizationError]),
});

const WsProviderUploadFeedbackRpc = Rpc.make(WS_METHODS.providerUploadFeedback, {
  payload: ProviderUploadFeedbackInput,
  success: ProviderUploadFeedbackResult,
  error: Schema.Union([ProviderUploadFeedbackError, EnvironmentAuthorizationError]),
});

const WsSubscribeVcsBranchRpc = Rpc.make(WS_METHODS.subscribeVcsBranch, {
  payload: VcsStatusInput,
  success: VcsBranchStatus,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsVcsRefreshBranchRpc = Rpc.make(WS_METHODS.vcsRefreshBranch, {
  payload: VcsStatusInput,
  success: Schema.Void,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusSubscriptionInput,
  success: VcsStatusStreamEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: Schema.Struct({
    ...VcsStatusInput.fields,
    localOnly: Schema.optional(Schema.Boolean),
  }),
  success: VcsStatusResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsSubscribeWorktreeSetupRpc = Rpc.make(WS_METHODS.subscribeWorktreeSetup, {
  payload: WorktreeSetupSubscribeInput,
  success: WorktreeSetupStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsWorktreeSetupCancelRpc = Rpc.make(WS_METHODS.worktreeSetupCancel, {
  payload: WorktreeSetupCancelInput,
  success: WorktreeSetupCancelResult,
  error: EnvironmentAuthorizationError,
});

const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  // Worktrees use the managed folder; required null path preserves compatibility with older servers.
  payload: Schema.Struct({ ...VcsCreateWorktreeInput.fields, path: Schema.Null }),
  success: VcsCreateWorktreeResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: Schema.Union([VcsError, EnvironmentAuthorizationError]),
});

const WsReviewGetBranchCommitsRpc = Rpc.make(WS_METHODS.reviewGetBranchCommits, {
  payload: ReviewBranchCommitsInput,
  success: ReviewBranchCommitsResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

const WsReviewGetDiffPreviewRpc = Rpc.make(WS_METHODS.reviewGetDiffPreview, {
  payload: ReviewDiffPreviewInput,
  success: ReviewDiffPreviewResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

const WsReviewGetDiffFileContentsRpc = Rpc.make(WS_METHODS.reviewGetDiffFileContents, {
  payload: ReviewDiffFileContentsInput,
  success: ReviewDiffFileContentsResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalAttachRpc = Rpc.make(WS_METHODS.terminalAttach, {
  payload: TerminalAttachInput,
  success: TerminalAttachStreamEvent,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsTerminalObserveRpc = Rpc.make(WS_METHODS.terminalObserve, {
  payload: TerminalObserveInput,
  success: TerminalAttachStreamEvent,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsPreviewOpenRpc = Rpc.make(WS_METHODS.previewOpen, {
  payload: PreviewOpenInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewResizeRpc = Rpc.make(WS_METHODS.previewResize, {
  payload: PreviewResizeInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewAdjustRpc = Rpc.make(WS_METHODS.previewAdjust, {
  payload: PreviewAdjustInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewCloseRpc = Rpc.make(WS_METHODS.previewClose, {
  payload: PreviewCloseInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewListRpc = Rpc.make(WS_METHODS.previewList, {
  payload: PreviewListInput,
  success: PreviewListResult,
  error: EnvironmentAuthorizationError,
});

const WsPreviewClearProfileRpc = Rpc.make(WS_METHODS.previewClearProfile, {
  payload: PreviewClearProfileInput,
  error: Schema.Union([PreviewClearProfileError, EnvironmentAuthorizationError]),
});

const WsPreviewReportProfilesRpc = Rpc.make(WS_METHODS.previewReportProfiles, {
  payload: PreviewReportProfilesInput,
  error: EnvironmentAuthorizationError,
});

const WsPreviewReportStatusRpc = Rpc.make(WS_METHODS.previewReportStatus, {
  payload: PreviewReportStatusInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsSubscribePreviewEventsRpc = Rpc.make(WS_METHODS.subscribePreviewEvents, {
  payload: Schema.Struct({}),
  success: PreviewEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsPreviewStopLocalServerRpc = Rpc.make(WS_METHODS.previewStopLocalServer, {
  payload: PreviewStopLocalServerInput,
  error: Schema.Union([PreviewStopLocalServerError, EnvironmentAuthorizationError]),
});

const WsSubscribeDiscoveredLocalServersRpc = Rpc.make(WS_METHODS.subscribeDiscoveredLocalServers, {
  payload: Schema.Struct({
    configuredUrls: Schema.optional(ConfiguredLocalServerUrls),
  }),
  success: DiscoveredLocalServerList,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsDeviceTestHostRpc = Rpc.make(WS_METHODS.deviceTestHost, {
  payload: SshDeviceHostConfig,
  success: DeviceHostSummary,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceEasAccountRpc = Rpc.make(WS_METHODS.deviceEasAccount, {
  payload: DeviceEasAccountInput,
  success: DeviceEasAccount,
  error: Schema.Union([DeviceEasAccountError, EnvironmentAuthorizationError]),
});

const WsDeviceSimlockIdentityRpc = Rpc.make(WS_METHODS.deviceSimlockIdentity, {
  payload: DeviceSimlockIdentityInput,
  success: DeviceSimlockIdentity,
  error: Schema.Union([DeviceSimlockIdentityError, EnvironmentAuthorizationError]),
});

const WsDeviceListRpc = Rpc.make(WS_METHODS.deviceList, {
  payload: DeviceListInput,
  success: DeviceServiceState,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceConfigureRpc = Rpc.make(WS_METHODS.deviceConfigure, {
  payload: DeviceConfigureInput,
  success: DeviceServiceState,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceOpenRpc = Rpc.make(WS_METHODS.deviceOpen, {
  payload: DeviceOpenInput,
  success: DeviceSession,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceCloseRpc = Rpc.make(WS_METHODS.deviceClose, {
  payload: DeviceCloseInput,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceShutdownRpc = Rpc.make(WS_METHODS.deviceShutdown, {
  payload: DeviceShutdownInput,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceDetailRpc = Rpc.make(WS_METHODS.deviceDetail, {
  payload: DeviceDetailInput,
  success: DeviceDetail,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceActionRpc = Rpc.make(WS_METHODS.deviceAction, {
  payload: DeviceActionInput,
  success: DeviceDetail,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsSubscribeDeviceStateRpc = Rpc.make(WS_METHODS.subscribeDeviceState, {
  payload: Schema.Struct({}),
  success: DeviceServiceState,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsOrchestrationV2DispatchCommandRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
  payload: OrchestrationV2RpcSchemas.dispatchCommand.input,
  success: OrchestrationV2RpcSchemas.dispatchCommand.output,
  error: Schema.Union([OrchestrationV2DispatchCommandError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetTurnDiffRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getTurnDiff, {
  payload: OrchestrationV2RpcSchemas.getTurnDiff.input,
  success: OrchestrationV2RpcSchemas.getTurnDiff.output,
  error: Schema.Union([OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationV2RpcSchemas.getFullThreadDiff.input,
    success: OrchestrationV2RpcSchemas.getFullThreadDiff.output,
    error: Schema.Union([OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2SearchThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.searchThread, {
  payload: OrchestrationV2SearchThreadInput,
  success: OrchestrationV2SearchThreadResult,
  error: Schema.Union([OrchestrationV2SearchThreadError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2SearchThreadStreamRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.searchThreadStream,
  {
    payload: OrchestrationV2SearchThreadInput,
    success: OrchestrationV2SearchThreadResult,
    error: Schema.Union([OrchestrationV2SearchThreadError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

const WsOrchestrationV2SearchThreadsRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.searchThreads, {
  payload: OrchestrationV2SearchThreadsInput,
  success: OrchestrationV2SearchThreadsResult,
  error: Schema.Union([OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetThreadFamilyRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getThreadFamily, {
  payload: OrchestrationV2RpcSchemas.getThreadFamily.input,
  success: OrchestrationV2RpcSchemas.getThreadFamily.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetThreadTitlesRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getThreadTitles, {
  payload: OrchestrationV2RpcSchemas.getThreadTitles.input,
  success: OrchestrationV2RpcSchemas.getThreadTitles.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetThreadLinkMetadataRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getThreadLinkMetadata,
  {
    payload: OrchestrationV2RpcSchemas.getThreadLinkMetadata.input,
    success: OrchestrationV2RpcSchemas.getThreadLinkMetadata.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetWorktreeThreadIdsRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getWorktreeThreadIds,
  {
    payload: OrchestrationV2RpcSchemas.getWorktreeThreadIds.input,
    success: OrchestrationV2RpcSchemas.getWorktreeThreadIds.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetOlderSettledThreadsRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads,
  {
    payload: OrchestrationV2RpcSchemas.getOlderSettledThreads.input,
    success: OrchestrationV2RpcSchemas.getOlderSettledThreads.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetThreadProjectionRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
  {
    payload: OrchestrationV2RpcSchemas.getThreadProjection.input,
    success: OrchestrationV2RpcSchemas.getThreadProjection.output,
    error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2StopWorkflowRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.stopWorkflow, {
  payload: OrchestrationV2RpcSchemas.stopWorkflow.input,
  success: OrchestrationV2RpcSchemas.stopWorkflow.output,
  error: Schema.Union([OrchestrationV2StopWorkflowError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2ForceStopThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.forceStopThread, {
  payload: OrchestrationV2RpcSchemas.forceStopThread.input,
  success: OrchestrationV2RpcSchemas.forceStopThread.output,
  error: Schema.Union([OrchestrationV2ForceStopThreadError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetWorkflowScriptRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getWorkflowScript,
  {
    payload: OrchestrationV2RpcSchemas.getWorkflowScript.input,
    success: OrchestrationV2RpcSchemas.getWorkflowScript.output,
    error: Schema.Union([OrchestrationGetWorkflowScriptError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetNativeChildWorkRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getNativeChildWork,
  {
    payload: OrchestrationV2RpcSchemas.getNativeChildWork.input,
    success: OrchestrationV2RpcSchemas.getNativeChildWork.output,
    error: Schema.Union([OrchestrationV2GetNativeChildWorkError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetTurnItemRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getTurnItem, {
  payload: OrchestrationV2RpcSchemas.getTurnItem.input,
  success: OrchestrationV2RpcSchemas.getTurnItem.output,
  error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2LaunchThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.launchThread, {
  payload: OrchestrationV2RpcSchemas.launchThread.input,
  success: OrchestrationV2RpcSchemas.launchThread.output,
  error: Schema.Union([OrchestrationV2ThreadLaunchError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2SubscribeShellRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeShell, {
  payload: OrchestrationV2RpcSchemas.subscribeShell.input,
  success: OrchestrationV2RpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationV2SubscribeThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
  payload: OrchestrationV2RpcSchemas.subscribeThread.input,
  success: OrchestrationV2RpcSchemas.subscribeThread.output,
  error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationV2SubscribeCommandOutputRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput,
  {
    payload: OrchestrationV2RpcSchemas.subscribeCommandOutput.input,
    success: OrchestrationV2RpcSchemas.subscribeCommandOutput.output,
    error: Schema.Union([OrchestrationV2CommandOutputError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

const WsOrchestrationV2SubscribePromptSuggestionRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.subscribePromptSuggestion,
  {
    payload: OrchestrationV2RpcSchemas.subscribePromptSuggestion.input,
    success: OrchestrationV2RpcSchemas.subscribePromptSuggestion.output,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

const WsSubscribeTerminalMetadataRpc = Rpc.make(WS_METHODS.subscribeTerminalMetadata, {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({
    /** Opt-in protects older clients that reject unknown theme event types. */
    environmentThemes: Schema.optional(Schema.Boolean),
    usageLimitSources: Schema.optional(Schema.Boolean),
    /** Advertise client handling before the server offers /usage-limits, or older clients send it as a prompt. */
    usageLimitsCommand: Schema.optional(Schema.Boolean),
    /** Omit per-cwd provider snapshots; the client fetches its cwd through `server.refreshProviders`. */
    workspaceSnapshotsOnDemand: Schema.optional(Schema.Boolean),
    /** With on-demand snapshots, also omit machine slash commands and skills a cwd snapshot replaces. */
    providerCatalogsOnDemand: Schema.optional(Schema.Boolean),
    /**
     * With on-demand catalogs, send a `catalogDigest` in place of the machine slash command names
     * and skills. The client keeps the lists it holds and loads new ones with a cwd snapshot.
     */
    providerCatalogDigests: Schema.optional(Schema.Boolean),
    /** Send provider changes as `providerStatusDeltas`; older clients reject the event type. */
    providerStatusDeltas: Schema.optional(Schema.Boolean),
  }),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsScheduledTasksSubscribeRpc = Rpc.make(WS_METHODS.scheduledTasksSubscribe, {
  payload: ScheduledTaskListInput,
  success: ScheduledTaskListResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsScheduledTasksUpsertRpc = Rpc.make(WS_METHODS.scheduledTasksUpsert, {
  payload: ScheduledTaskUpsertInput,
  success: ScheduledTaskMutationResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksSetEnabledRpc = Rpc.make(WS_METHODS.scheduledTasksSetEnabled, {
  payload: ScheduledTaskSetEnabledInput,
  success: ScheduledTaskMutationResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksDeleteRpc = Rpc.make(WS_METHODS.scheduledTasksDelete, {
  payload: ScheduledTaskDeleteInput,
  success: ScheduledTaskDeleteResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksRunNowRpc = Rpc.make(WS_METHODS.scheduledTasksRunNow, {
  payload: ScheduledTaskRunNowInput,
  success: ScheduledTaskRunNowResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksRotateWebhookTokenRpc = Rpc.make(
  WS_METHODS.scheduledTasksRotateWebhookToken,
  {
    payload: ScheduledTaskRotateWebhookTokenInput,
    success: ScheduledTaskMutationResult,
    error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
  },
);

const WsGuestShareCreateRpc = Rpc.make(WS_METHODS.guestShareCreate, {
  payload: GuestShareCreateInput,
  success: GuestShareCreateResult,
  error: Schema.Union([GuestShareCreateError, EnvironmentAuthorizationError]),
});

const WsSecretsAnswerRequestRpc = Rpc.make(WS_METHODS.secretsAnswerRequest, {
  payload: SecretRequestAnswerInput,
  error: Schema.Union([SecretRequestError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksListWebhookDeliveriesRpc = Rpc.make(
  WS_METHODS.scheduledTasksListWebhookDeliveries,
  {
    payload: ScheduledTaskListWebhookDeliveriesInput,
    success: ScheduledTaskListWebhookDeliveriesResult,
    error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
  },
);

const WsScheduledTasksGetWebhookDeliveryRpc = Rpc.make(
  WS_METHODS.scheduledTasksGetWebhookDelivery,
  {
    payload: ScheduledTaskGetWebhookDeliveryInput,
    success: ScheduledTaskGetWebhookDeliveryResult,
    error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
  },
);

const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: Schema.Union([AuthAccessStreamError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeResourceTelemetryRpc = Rpc.make(WS_METHODS.subscribeResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetrySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsMajordomeGetPushConfigRpc = Rpc.make(WS_METHODS.majordomeGetPushConfig, {
  payload: Schema.Struct({}),
  success: MajordomePushConfig,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeSavePushSubscriptionRpc = Rpc.make(WS_METHODS.majordomeSavePushSubscription, {
  payload: MajordomeSavePushSubscriptionInput,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeRemovePushSubscriptionRpc = Rpc.make(WS_METHODS.majordomeRemovePushSubscription, {
  payload: MajordomePushEndpointInput,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeSendTestPushRpc = Rpc.make(WS_METHODS.majordomeSendTestPush, {
  payload: MajordomePushEndpointInput,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeListPushDevicesRpc = Rpc.make(WS_METHODS.majordomeListPushDevices, {
  payload: Schema.Struct({}),
  success: MajordomePushDevices,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeGetPhoneSetupRpc = Rpc.make(WS_METHODS.majordomeGetPhoneSetup, {
  payload: Schema.Struct({}),
  success: MajordomePhoneSetup,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeEnableSecureAddressRpc = Rpc.make(WS_METHODS.majordomeEnableSecureAddress, {
  payload: Schema.Struct({}),
  success: MajordomePhoneSetup,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeEnableAnywhereAddressRpc = Rpc.make(WS_METHODS.majordomeEnableAnywhereAddress, {
  payload: Schema.Struct({}),
  success: MajordomePhoneSetup,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeDisableAnywhereAddressRpc = Rpc.make(WS_METHODS.majordomeDisableAnywhereAddress, {
  payload: Schema.Struct({}),
  success: MajordomePhoneSetup,
  error: Schema.Union([MajordomePhoneError, EnvironmentAuthorizationError]),
});

const WsMajordomeListVaultHistoryRpc = Rpc.make(WS_METHODS.majordomeListVaultHistory, {
  payload: MajordomeVaultHistoryInput,
  success: MajordomeVaultHistoryResult,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

// A revision that moves on whenever the vault's notes change on disk.
const WsMajordomeSubscribeVaultChangesRpc = Rpc.make(WS_METHODS.majordomeSubscribeVaultChanges, {
  payload: MajordomeVaultChangesInput,
  success: NonNegativeInt,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsMajordomeUndoVaultRunRpc = Rpc.make(WS_METHODS.majordomeUndoVaultRun, {
  payload: MajordomeVaultUndoInput,
  success: MajordomeVaultUndoResult,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeRunRoutinesHereRpc = Rpc.make(WS_METHODS.majordomeRunRoutinesHere, {
  payload: MajordomeRunRoutinesHereInput,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeListReadyRoutinesRpc = Rpc.make(WS_METHODS.majordomeListReadyRoutines, {
  payload: MajordomeReadyRoutinesInput,
  success: MajordomeReadyRoutinesResult,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeAddReadyRoutineRpc = Rpc.make(WS_METHODS.majordomeAddReadyRoutine, {
  payload: MajordomeAddReadyRoutineInput,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeSetRoutineLimitsRpc = Rpc.make(WS_METHODS.majordomeSetRoutineLimits, {
  payload: MajordomeSetRoutineLimitsInput,
  success: MajordomeRoutineLimits,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeStartNotesRpc = Rpc.make(WS_METHODS.majordomeStartNotes, {
  payload: MajordomeStartNotesInput,
  success: MajordomeStartNotesResult,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeSearchNotesRpc = Rpc.make(WS_METHODS.majordomeSearchNotes, {
  payload: MajordomeNotesSearchInput,
  success: MajordomeNotesSearchResult,
  error: Schema.Union([MajordomeNotesSearchError, EnvironmentAuthorizationError]),
});

const WsMajordomeGetNotesIndexStatusRpc = Rpc.make(WS_METHODS.majordomeGetNotesIndexStatus, {
  payload: MajordomeNotesIndexInput,
  success: MajordomeNotesIndexResult,
  error: Schema.Union([MajordomeNotesSearchError, EnvironmentAuthorizationError]),
});

const WsMajordomeRebuildNotesIndexRpc = Rpc.make(WS_METHODS.majordomeRebuildNotesIndex, {
  payload: MajordomeNotesIndexInput,
  success: MajordomeNotesIndexResult,
  error: Schema.Union([MajordomeNotesSearchError, EnvironmentAuthorizationError]),
});

const WsMajordomeListConnectorsRpc = Rpc.make(WS_METHODS.majordomeListConnectors, {
  payload: MajordomeConnectorsInput,
  success: MajordomeConnectorsResult,
  error: EnvironmentAuthorizationError,
});

const privateDocumentErrors = Schema.Union([
  MajordomePrivateDocumentError,
  EnvironmentAuthorizationError,
]);

const WsMajordomeListPrivateDocumentsRpc = Rpc.make(WS_METHODS.majordomeListPrivateDocuments, {
  payload: Schema.Struct({}),
  success: MajordomePrivateDocumentsResult,
  error: privateDocumentErrors,
});

const WsMajordomeAddPrivateDocumentRpc = Rpc.make(WS_METHODS.majordomeAddPrivateDocument, {
  payload: MajordomeAddPrivateDocumentInput,
  success: MajordomePrivateDocument,
  error: privateDocumentErrors,
});

const WsMajordomeRemovePrivateDocumentRpc = Rpc.make(WS_METHODS.majordomeRemovePrivateDocument, {
  payload: MajordomePrivateDocumentInput,
  error: privateDocumentErrors,
});

const WsMajordomeViewPrivateDocumentRpc = Rpc.make(WS_METHODS.majordomeViewPrivateDocument, {
  payload: MajordomePrivateDocumentInput,
  success: MajordomeViewPrivateDocumentResult,
  error: privateDocumentErrors,
});

const WsMajordomeGetPrivateDocumentRequestRpc = Rpc.make(
  WS_METHODS.majordomeGetPrivateDocumentRequest,
  {
    payload: MajordomePrivateDocumentRequestInput,
    success: Schema.NullOr(MajordomePrivateDocumentRequest),
    error: EnvironmentAuthorizationError,
  },
);

const WsMajordomeAnswerPrivateDocumentRequestRpc = Rpc.make(
  WS_METHODS.majordomeAnswerPrivateDocumentRequest,
  {
    payload: MajordomeAnswerPrivateDocumentRequestInput,
    error: privateDocumentErrors,
  },
);

const WsMajordomeGetApprovalRpc = Rpc.make(WS_METHODS.majordomeGetApproval, {
  payload: MajordomeApprovalInput,
  success: Schema.NullOr(MajordomeApproval),
  error: EnvironmentAuthorizationError,
});

const WsMajordomeAnswerApprovalRpc = Rpc.make(WS_METHODS.majordomeAnswerApproval, {
  payload: MajordomeAnswerApprovalInput,
  error: Schema.Union([MajordomeApprovalError, EnvironmentAuthorizationError]),
});

const WsMajordomeListTopicsRpc = Rpc.make(WS_METHODS.majordomeListTopics, {
  payload: MajordomeTopicsInput,
  success: MajordomeTopicsResult,
  error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
});

const WsMajordomeCreateTopicRpc = Rpc.make(WS_METHODS.majordomeCreateTopic, {
  payload: MajordomeCreateTopicInput,
  success: MajordomeTopic,
  error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
});

const WsMajordomeSuggestTopicFolderRpc = Rpc.make(WS_METHODS.majordomeSuggestTopicFolder, {
  payload: MajordomeSuggestTopicFolderInput,
  success: MajordomeSuggestTopicFolderResult,
  error: EnvironmentAuthorizationError,
});

const WsMajordomeUpdateTopicRpc = Rpc.make(WS_METHODS.majordomeUpdateTopic, {
  payload: MajordomeUpdateTopicInput,
  success: MajordomeTopic,
  error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
});

const WsMajordomeReorderTopicsRpc = Rpc.make(WS_METHODS.majordomeReorderTopics, {
  payload: MajordomeReorderTopicsInput,
  error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
});

const WsMajordomeRemoveTopicRpc = Rpc.make(WS_METHODS.majordomeRemoveTopic, {
  payload: MajordomeTopicRefInput,
  error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
});

const WsMajordomeOpenTopicRpc = Rpc.make(WS_METHODS.majordomeOpenTopic, {
  payload: MajordomeOpenTopicInput,
  success: MajordomeOpenTopicResult,
  error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
});

const WsMajordomeSetThreadTopicRpc = Rpc.make(WS_METHODS.majordomeSetThreadTopic, {
  payload: MajordomeSetThreadTopicInput,
  error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
});

const WsMajordomeOpenRoutinesConversationRpc = Rpc.make(
  WS_METHODS.majordomeOpenRoutinesConversation,
  {
    payload: MajordomeOpenRoutinesConversationInput,
    success: MajordomeOpenTopicResult,
    error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
  },
);

const WsMajordomeDismissTopicSuggestionsRpc = Rpc.make(
  WS_METHODS.majordomeDismissTopicSuggestions,
  {
    payload: MajordomeDismissTopicSuggestionsInput,
    error: Schema.Union([MajordomeTopicsError, EnvironmentAuthorizationError]),
  },
);

const readingListError = Schema.Union([MajordomeReadingListError, EnvironmentAuthorizationError]);

const WsMajordomeListReadingItemsRpc = Rpc.make(WS_METHODS.majordomeListReadingItems, {
  payload: MajordomeReadingListInput,
  success: MajordomeReadingListResult,
  error: readingListError,
});

const WsMajordomeAddReadingItemRpc = Rpc.make(WS_METHODS.majordomeAddReadingItem, {
  payload: MajordomeAddReadingItemInput,
  success: MajordomeAddReadingItemResult,
  error: readingListError,
});

const WsMajordomeUpdateReadingItemRpc = Rpc.make(WS_METHODS.majordomeUpdateReadingItem, {
  payload: MajordomeUpdateReadingItemInput,
  success: MajordomeReadingItem,
  error: readingListError,
});

const WsMajordomeReorderReadingItemsRpc = Rpc.make(WS_METHODS.majordomeReorderReadingItems, {
  payload: MajordomeReorderReadingItemsInput,
  error: readingListError,
});

const WsMajordomeRemoveReadingItemRpc = Rpc.make(WS_METHODS.majordomeRemoveReadingItem, {
  payload: MajordomeReadingItemRefInput,
  error: readingListError,
});

const WsMajordomeRestoreReadingItemRpc = Rpc.make(WS_METHODS.majordomeRestoreReadingItem, {
  payload: MajordomeRestoreReadingItemInput,
  error: readingListError,
});

const WsMajordomeSaveReadingSubjectsRpc = Rpc.make(WS_METHODS.majordomeSaveReadingSubjects, {
  payload: MajordomeSaveReadingSubjectsInput,
  success: MajordomeSaveReadingSubjectsResult,
  error: readingListError,
});

const WsMajordomeListTodosRpc = Rpc.make(WS_METHODS.majordomeListTodos, {
  payload: MajordomeTodosInput,
  success: MajordomeTodosResult,
  error: Schema.Union([MajordomeTodosError, EnvironmentAuthorizationError]),
});

const WsMajordomeSetTodoDoneRpc = Rpc.make(WS_METHODS.majordomeSetTodoDone, {
  payload: MajordomeSetTodoDoneInput,
  error: Schema.Union([MajordomeTodosError, EnvironmentAuthorizationError]),
});

const WsMajordomeAddTodoRpc = Rpc.make(WS_METHODS.majordomeAddTodo, {
  payload: MajordomeAddTodoInput,
  error: Schema.Union([MajordomeTodosError, EnvironmentAuthorizationError]),
});

const WsMajordomeGetDailyNoteRpc = Rpc.make(WS_METHODS.majordomeGetDailyNote, {
  payload: MajordomeDailyNoteInput,
  success: MajordomeDailyNoteResult,
  error: Schema.Union([MajordomeDailyNoteError, EnvironmentAuthorizationError]),
});

const WsMajordomeSaveDailyNoteRpc = Rpc.make(WS_METHODS.majordomeSaveDailyNote, {
  payload: MajordomeSaveDailyNoteInput,
  error: Schema.Union([MajordomeDailyNoteError, EnvironmentAuthorizationError]),
});

const WsMajordomeSaveNoteRpc = Rpc.make(WS_METHODS.majordomeSaveNote, {
  payload: MajordomeSaveNoteInput,
  error: Schema.Union([MajordomeNoteError, EnvironmentAuthorizationError]),
});

const WsMajordomeAddToDailyNoteRpc = Rpc.make(WS_METHODS.majordomeAddToDailyNote, {
  payload: MajordomeAddToDailyNoteInput,
  error: Schema.Union([MajordomeDailyNoteError, EnvironmentAuthorizationError]),
});

const WsMajordomeGetKeyFactsRpc = Rpc.make(WS_METHODS.majordomeGetKeyFacts, {
  payload: MajordomeKeyFactsInput,
  success: MajordomeKeyFactsResult,
  error: EnvironmentAuthorizationError,
});

const WsMajordomeDrawConversationRpc = Rpc.make(WS_METHODS.majordomeDrawConversation, {
  payload: MajordomeDrawConversationInput,
  success: MajordomeDrawConversationResult,
  error: Schema.Union([MajordomeDrawConversationError, EnvironmentAuthorizationError]),
});

const topicFilesErrors = Schema.Union([MajordomeTopicFilesError, EnvironmentAuthorizationError]);

const WsMajordomeListTopicFilesRpc = Rpc.make(WS_METHODS.majordomeListTopicFiles, {
  payload: MajordomeTopicFilesInput,
  success: MajordomeTopicFilesResult,
  error: topicFilesErrors,
});

const WsMajordomeAddTopicFileRpc = Rpc.make(WS_METHODS.majordomeAddTopicFile, {
  payload: MajordomeAddTopicFileInput,
  success: MajordomeTopicFile,
  error: topicFilesErrors,
});

const WsMajordomeRemoveTopicFileRpc = Rpc.make(WS_METHODS.majordomeRemoveTopicFile, {
  payload: MajordomeTopicFileInput,
  error: topicFilesErrors,
});

const WsMajordomeViewTopicFileRpc = Rpc.make(WS_METHODS.majordomeViewTopicFile, {
  payload: MajordomeTopicFileInput,
  success: MajordomeViewTopicFileResult,
  error: topicFilesErrors,
});

const serverMoveErrors = Schema.Union([MajordomeServerMoveError, EnvironmentAuthorizationError]);

// The current state of "Set up a server for me", then every change: progress is never guessed.
const WsMajordomeServerMoveSubscribeRpc = Rpc.make(WS_METHODS.majordomeServerMoveSubscribe, {
  payload: Schema.Struct({}),
  success: MajordomeServerMoveStatus,
  error: serverMoveErrors,
  stream: true,
});

const WsMajordomeServerMoveSaveKeysRpc = Rpc.make(WS_METHODS.majordomeServerMoveSaveKeys, {
  payload: MajordomeServerMoveSaveKeysInput,
  success: MajordomeServerMoveStatus,
  error: serverMoveErrors,
});

const WsMajordomeServerMoveForgetKeysRpc = Rpc.make(WS_METHODS.majordomeServerMoveForgetKeys, {
  payload: Schema.Struct({}),
  success: MajordomeServerMoveStatus,
  error: serverMoveErrors,
});

const WsMajordomeServerMoveCheckRpc = Rpc.make(WS_METHODS.majordomeServerMoveCheck, {
  payload: MajordomeServerMoveCheckInput,
  success: MajordomeServerMoveCheck,
  error: serverMoveErrors,
});

const WsMajordomeServerMoveStartRpc = Rpc.make(WS_METHODS.majordomeServerMoveStart, {
  payload: MajordomeServerMoveStartInput,
  success: MajordomeServerMoveStatus,
  error: serverMoveErrors,
});

const WsMajordomeServerMoveRetryRpc = Rpc.make(WS_METHODS.majordomeServerMoveRetry, {
  payload: Schema.Struct({}),
  success: MajordomeServerMoveStatus,
  error: serverMoveErrors,
});

const WsMajordomeServerMoveCancelRpc = Rpc.make(WS_METHODS.majordomeServerMoveCancel, {
  payload: MajordomeServerMoveCancelInput,
  success: MajordomeServerMoveStatus,
  error: serverMoveErrors,
});

const WsMajordomeServerMoveIssuePairingLinkRpc = Rpc.make(
  WS_METHODS.majordomeServerMoveIssuePairingLink,
  {
    payload: Schema.Struct({}),
    success: MajordomeServerMovePairingLink,
    error: serverMoveErrors,
  },
);

const WsMajordomeServerMoveRoutinesRpc = Rpc.make(WS_METHODS.majordomeServerMoveRoutines, {
  payload: Schema.Struct({}),
  success: MajordomeServerMoveStatus,
  error: serverMoveErrors,
});

const WsMajordomeServerMoveRemoveRpc = Rpc.make(WS_METHODS.majordomeServerMoveRemove, {
  payload: MajordomeServerMoveRemoveInput,
  success: MajordomeServerMoveStatus,
  error: serverMoveErrors,
});

const WsMajordomeGetBackupStatusRpc = Rpc.make(WS_METHODS.majordomeGetBackupStatus, {
  payload: MajordomeBackupInput,
  success: MajordomeBackupStatus,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeBackUpNowRpc = Rpc.make(WS_METHODS.majordomeBackUpNow, {
  payload: MajordomeBackUpNowInput,
  success: MajordomeBackupStatus,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeConfigureBackupRpc = Rpc.make(WS_METHODS.majordomeConfigureBackup, {
  payload: MajordomeConfigureBackupInput,
  success: MajordomeBackupStatus,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeLinkPeerRpc = Rpc.make(WS_METHODS.majordomeLinkPeer, {
  payload: MajordomeLinkPeerInput,
  success: MajordomeBackupStatus,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeUnlinkPeerRpc = Rpc.make(WS_METHODS.majordomeUnlinkPeer, {
  payload: MajordomeBackupInput,
  success: MajordomeBackupStatus,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeConnectGitHubStartRpc = Rpc.make(WS_METHODS.majordomeConnectGitHubStart, {
  payload: MajordomeBackupInput,
  success: MajordomeGitHubConnectPrompt,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeConnectGitHubWaitRpc = Rpc.make(WS_METHODS.majordomeConnectGitHubWait, {
  payload: MajordomeBackupInput,
  success: MajordomeBackupStatus,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeConnectGitHubCancelRpc = Rpc.make(WS_METHODS.majordomeConnectGitHubCancel, {
  payload: MajordomeBackupInput,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeConnectGoogleDriveStartRpc = Rpc.make(
  WS_METHODS.majordomeConnectGoogleDriveStart,
  {
    payload: MajordomeBackupInput,
    success: MajordomeGoogleDriveConnectPrompt,
    error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
  },
);

const WsMajordomeConnectGoogleDriveWaitRpc = Rpc.make(WS_METHODS.majordomeConnectGoogleDriveWait, {
  payload: MajordomeBackupInput,
  success: MajordomeBackupStatus,
  error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
});

const WsMajordomeConnectGoogleDriveCancelRpc = Rpc.make(
  WS_METHODS.majordomeConnectGoogleDriveCancel,
  {
    payload: MajordomeBackupInput,
    error: Schema.Union([MajordomeVaultError, EnvironmentAuthorizationError]),
  },
);

export class RpcScopeAuthorization extends RpcMiddleware.Service<RpcScopeAuthorization>()(
  "t3/contracts/RpcScopeAuthorization",
  { error: EnvironmentAuthorizationError },
) {}

export const WsRpcGroup = RpcGroup.make(
  WsIssuesListRpc,
  WsIssuesDetailRpc,
  WsIssuesCommentsRpc,
  WsIssuesTemplatesRpc,
  WsIssuesCandidatesRpc,
  WsIssuesLinkedThreadsRpc,
  WsIssuesCreateRpc,
  WsIssuesCommentRpc,
  WsIssuesUpdateRpc,
  WsIssuesSetStateRpc,
  WsIssuesReactRpc,
  WsIssueTrackersListRpc,
  WsIssueTrackersConnectRpc,
  WsIssueTrackersBindProjectRpc,
  WsGuestShareCreateRpc,
  WsServerProbeRpc,
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsProviderConsumeResetCreditRpc,
  WsProviderAuthStartRpc,
  WsProviderAuthCompleteRpc,
  WsChatGptReconnectProfileRpc,
  WsChatGptImportProfileRpc,
  WsChatGptHandoffSubscribeRpc,
  WsProviderAuthRespondRpc,
  WsProviderAuthCancelRpc,
  WsProviderAuthRemoveMethodRpc,
  WsProviderAuthLogoutRpc,
  WsProviderAuthSubscribeRpc,
  WsClaudeSignInStartRpc,
  WsClaudeSignInSubmitRpc,
  WsClaudeSignInCancelRpc,
  WsProviderInstallStartRpc,
  WsProviderInstallCancelRpc,
  WsProviderInstallSubscribeRpc,
  WsProviderInstallRemoveRpc,
  WsServerUpdateServerRpc,
  WsServerGetNpmReleaseRpc,
  WsServerUpdateServerWithProgressRpc,
  WsServerCommitDesktopUpdateRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerRunStorageCleanupRpc,
  WsServerGetStorageCleanupReportRpc,
  WsServerGetDatabaseStorageRpc,
  WsServerGetSettingsRpc,
  WsServerReclaimDatabaseSpaceRpc,
  WsServerUpdateSettingsRpc,
  WsPeerLinksListRpc,
  WsPeerLinksLinkRpc,
  WsPeerLinksUnlinkRpc,
  WsPeerLinksAnswerRequestRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerCheckSecretSourceRpc,
  WsServerSearchAcpRegistryRpc,
  WsServerPrepareAcpRegistryAgentRpc,
  WsServerUninstallAcpRegistryManagedBinaryRpc,
  WsServerAcceptAcpRegistryUrlAuthRpc,
  WsServerListAcpRegistrySessionsRpc,
  WsServerImportAcpRegistrySessionRpc,
  WsServerDeleteAcpRegistrySessionRpc,
  WsServerListAcpRegistryProvidersRpc,
  WsServerSetAcpRegistryProviderRpc,
  WsServerDisableAcpRegistryProviderRpc,
  WsServerLogoutAcpRegistryRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetHostResourcesRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerGetResourceTelemetryHistoryRpc,
  WsServerRetryResourceTelemetryRpc,
  WsServerCheckOtlpEndpointRpc,
  WsServerListTextGeneratorModelsRpc,
  WsServerPrepareTriageRpc,
  WsServerGetUsageSummaryRpc,
  WsServerRefreshUsageRatesRpc,
  WsServerSignalProcessRpc,
  WsScheduledTasksSubscribeRpc,
  WsScheduledTasksUpsertRpc,
  WsScheduledTasksSetEnabledRpc,
  WsScheduledTasksDeleteRpc,
  WsScheduledTasksRunNowRpc,
  WsScheduledTasksRotateWebhookTokenRpc,
  WsSecretsAnswerRequestRpc,
  WsScheduledTasksListWebhookDeliveriesRpc,
  WsScheduledTasksGetWebhookDeliveryRpc,
  WsServerReportClientActivityRpc,
  WsCloudGetRelayClientStatusRpc,
  WsCloudInstallRelayClientRpc,
  WsPullRequestsListRpc,
  WsPullRequestsListStatsRpc,
  WsPullRequestsFilterOptionsRpc,
  WsPullRequestsSummaryRpc,
  WsPullRequestsRoutingRpc,
  WsPullRequestsRoutingIdentityRpc,
  WsPullRequestsStackRpc,
  WsPullRequestsLinkedThreadsRpc,
  WsPullRequestsDetailRpc,
  WsPullRequestsPreviewRpc,
  WsPullRequestsChecksRpc,
  WsPullRequestsActivityRpc,
  WsPullRequestsReviewGuideRpc,
  WsPullRequestsGenerateReviewGuideRpc,
  WsPullRequestsThreadCommentsRpc,
  WsPullRequestsDiffFileContentsRpc,
  WsPullRequestsFilesViewedRpc,
  WsPullRequestsChangeBreakdownRpc,
  WsPullRequestsSetFilesViewedRpc,
  WsPullRequestsRunActionRpc,
  WsPullRequestsUpdateRpc,
  WsPullRequestsCommentRpc,
  WsPullRequestsUpdateCommentRpc,
  WsPullRequestsSubmitReviewRpc,
  WsPullRequestsReplyToThreadRpc,
  WsPullRequestsSetThreadResolutionRpc,
  WsPullRequestsSetReactionRpc,
  WsPullRequestsInvalidateRpc,
  WsPullRequestsReportStateRpc,
  WsPullRequestsSubscribeRefreshesRpc,
  WsPullRequestsSubscribeLinkedThreadRefreshesRpc,
  WsPullRequestsReviewerCandidatesRpc,
  WsPullRequestsRequestReviewersRpc,
  WsPullRequestsLabelCandidatesRpc,
  WsPullRequestsSetLabelsRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsSourceControlSignInStartRpc,
  WsSourceControlSignInWaitRpc,
  WsSourceControlSignInCancelRpc,
  WsSourceControlAppAccessRpc,
  WsSourceControlStarredRpc,
  WsSourceControlStarRpc,
  WsProjectCloneStartRpc,
  WsProjectCloneCancelRpc,
  WsProjectCloneRetryRpc,
  WsSubscribeProjectClonesRpc,
  WsProjectsListEntriesRpc,
  WsProjectsListIgnoredFilesRpc,
  WsProjectsReadFileRpc,
  WsProjectsSearchContentsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsEnsureScratchRpc,
  WsProjectsCreateNewRpc,
  WsProjectsCreateFromThreadRpc,
  WsProjectsWriteFileRpc,
  WsProjectsMutateRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsFilesystemGetMetadataRpc,
  WsAgentSessionsScanRpc,
  WsAgentSessionsImportRpc,
  WsAssetsCreateUrlRpc,
  WsAssetsPersistChatAttachmentsRpc,
  WsAttachmentsCreateUploadUrlRpc,
  WsAttachmentsDeleteRpc,
  WsMcpAppsCallToolRpc,
  WsMcpAppsToolInfoRpc,
  WsMcpAppsReadResourceRpc,
  WsMcpAppsUpdateModelContextRpc,
  WsProviderUploadFeedbackRpc,
  WsSubscribeVcsStatusRpc,
  WsSubscribeVcsBranchRpc,
  WsVcsRefreshBranchRpc,
  WsSubscribeWorktreeSetupRpc,
  WsWorktreeSetupCancelRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsReviewGetBranchCommitsRpc,
  WsReviewGetDiffPreviewRpc,
  WsReviewGetDiffFileContentsRpc,
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalObserveRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalMetadataRpc,
  WsPreviewOpenRpc,
  WsPreviewResizeRpc,
  WsPreviewAdjustRpc,
  WsPreviewCloseRpc,
  WsPreviewListRpc,
  WsPreviewClearProfileRpc,
  WsPreviewReportProfilesRpc,
  WsPreviewReportStatusRpc,
  WsSubscribePreviewEventsRpc,
  WsPreviewStopLocalServerRpc,
  WsSubscribeDiscoveredLocalServersRpc,
  WsDeviceConfigureRpc,
  WsDeviceListRpc,
  WsDeviceTestHostRpc,
  WsDeviceEasAccountRpc,
  WsDeviceSimlockIdentityRpc,
  WsDeviceOpenRpc,
  WsDeviceCloseRpc,
  WsDeviceShutdownRpc,
  WsDeviceDetailRpc,
  WsDeviceActionRpc,
  WsSubscribeDeviceStateRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsSubscribeResourceTelemetryRpc,
  WsOrchestrationV2DispatchCommandRpc,
  WsOrchestrationV2GetWorkflowScriptRpc,
  WsOrchestrationV2GetNativeChildWorkRpc,
  WsOrchestrationV2StopWorkflowRpc,
  WsOrchestrationV2ForceStopThreadRpc,
  WsOrchestrationV2GetTurnItemRpc,
  WsOrchestrationV2GetTurnDiffRpc,
  WsOrchestrationV2GetFullThreadDiffRpc,
  WsOrchestrationV2SearchThreadsRpc,
  WsOrchestrationV2SearchThreadRpc,
  WsOrchestrationV2SearchThreadStreamRpc,
  WsOrchestrationV2GetArchivedShellSnapshotRpc,
  WsOrchestrationV2GetThreadFamilyRpc,
  WsOrchestrationV2GetThreadTitlesRpc,
  WsOrchestrationV2GetThreadLinkMetadataRpc,
  WsOrchestrationV2GetWorktreeThreadIdsRpc,
  WsOrchestrationV2GetOlderSettledThreadsRpc,
  WsOrchestrationV2GetThreadProjectionRpc,
  WsOrchestrationV2LaunchThreadRpc,
  WsOrchestrationV2SubscribeShellRpc,
  WsOrchestrationV2SubscribeThreadRpc,
  WsOrchestrationV2SubscribeCommandOutputRpc,
  WsOrchestrationV2SubscribePromptSuggestionRpc,
  WsMajordomeGetPushConfigRpc,
  WsMajordomeSavePushSubscriptionRpc,
  WsMajordomeRemovePushSubscriptionRpc,
  WsMajordomeSendTestPushRpc,
  WsMajordomeListPushDevicesRpc,
  WsMajordomeGetPhoneSetupRpc,
  WsMajordomeEnableSecureAddressRpc,
  WsMajordomeEnableAnywhereAddressRpc,
  WsMajordomeDisableAnywhereAddressRpc,
  WsMajordomeListVaultHistoryRpc,
  WsMajordomeSubscribeVaultChangesRpc,
  WsMajordomeUndoVaultRunRpc,
  WsMajordomeRunRoutinesHereRpc,
  WsMajordomeListReadyRoutinesRpc,
  WsMajordomeAddReadyRoutineRpc,
  WsMajordomeSetRoutineLimitsRpc,
  WsMajordomeStartNotesRpc,
  WsMajordomeGetBackupStatusRpc,
  WsMajordomeServerMoveSubscribeRpc,
  WsMajordomeServerMoveSaveKeysRpc,
  WsMajordomeServerMoveForgetKeysRpc,
  WsMajordomeServerMoveCheckRpc,
  WsMajordomeServerMoveStartRpc,
  WsMajordomeServerMoveRetryRpc,
  WsMajordomeServerMoveCancelRpc,
  WsMajordomeServerMoveIssuePairingLinkRpc,
  WsMajordomeServerMoveRoutinesRpc,
  WsMajordomeServerMoveRemoveRpc,
  WsMajordomeListConnectorsRpc,
  WsMajordomeSearchNotesRpc,
  WsMajordomeGetNotesIndexStatusRpc,
  WsMajordomeRebuildNotesIndexRpc,
  WsMajordomeListPrivateDocumentsRpc,
  WsMajordomeAddPrivateDocumentRpc,
  WsMajordomeRemovePrivateDocumentRpc,
  WsMajordomeViewPrivateDocumentRpc,
  WsMajordomeGetPrivateDocumentRequestRpc,
  WsMajordomeAnswerPrivateDocumentRequestRpc,
  WsMajordomeGetApprovalRpc,
  WsMajordomeAnswerApprovalRpc,
  WsMajordomeBackUpNowRpc,
  WsMajordomeConfigureBackupRpc,
  WsMajordomeLinkPeerRpc,
  WsMajordomeUnlinkPeerRpc,
  WsMajordomeConnectGitHubStartRpc,
  WsMajordomeConnectGitHubWaitRpc,
  WsMajordomeConnectGitHubCancelRpc,
  WsMajordomeConnectGoogleDriveStartRpc,
  WsMajordomeConnectGoogleDriveWaitRpc,
  WsMajordomeConnectGoogleDriveCancelRpc,
  WsMajordomeListTopicsRpc,
  WsMajordomeCreateTopicRpc,
  WsMajordomeSuggestTopicFolderRpc,
  WsMajordomeUpdateTopicRpc,
  WsMajordomeReorderTopicsRpc,
  WsMajordomeRemoveTopicRpc,
  WsMajordomeOpenTopicRpc,
  WsMajordomeSetThreadTopicRpc,
  WsMajordomeOpenRoutinesConversationRpc,
  WsMajordomeDismissTopicSuggestionsRpc,
  WsMajordomeListReadingItemsRpc,
  WsMajordomeAddReadingItemRpc,
  WsMajordomeUpdateReadingItemRpc,
  WsMajordomeReorderReadingItemsRpc,
  WsMajordomeRemoveReadingItemRpc,
  WsMajordomeRestoreReadingItemRpc,
  WsMajordomeSaveReadingSubjectsRpc,
  WsMajordomeListTodosRpc,
  WsMajordomeSetTodoDoneRpc,
  WsMajordomeAddTodoRpc,
  WsMajordomeGetDailyNoteRpc,
  WsMajordomeSaveDailyNoteRpc,
  WsMajordomeSaveNoteRpc,
  WsMajordomeAddToDailyNoteRpc,
  WsMajordomeListTopicFilesRpc,
  WsMajordomeGetKeyFactsRpc,
  WsMajordomeDrawConversationRpc,
  WsMajordomeAddTopicFileRpc,
  WsMajordomeRemoveTopicFileRpc,
  WsMajordomeViewTopicFileRpc,
).middleware(RpcScopeAuthorization);
