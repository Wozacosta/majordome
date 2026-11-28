import type { EnvironmentId, MajordomeTopicsResult, ProjectId, ThreadId } from "@t3tools/contracts";

/** A computer's Set-up chat: where it is, and its thread once it has been started. */
export interface SetupChatRef {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | null;
}

/**
 * The Set-up chat of each notes folder among the listed projects, from each project's topic list
 * (null while it loads or when its computer cannot be reached). A computer from before the
 * Set-up chat does not say `setupThreadId` at all, and is left out.
 */
export function findSetupChats(
  projects: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ProjectId }>,
  results: ReadonlyArray<Pick<MajordomeTopicsResult, "isVault" | "setupThreadId"> | null>,
): ReadonlyArray<SetupChatRef> {
  return projects.flatMap((project, index) => {
    const result = results[index];
    if (result == null || !result.isVault || result.setupThreadId === undefined) return [];
    return [
      {
        environmentId: project.environmentId,
        projectId: project.id,
        threadId: result.setupThreadId,
      },
    ];
  });
}

/** Whether a chat is some computer's Set-up chat. */
export function isSetupChat(
  chats: ReadonlyArray<SetupChatRef>,
  environmentId: string,
  threadId: string,
): boolean {
  return chats.some((chat) => chat.environmentId === environmentId && chat.threadId === threadId);
}

/** What the Set-up chat's message box invites. */
export const SETUP_CHAT_PLACEHOLDER = "Ask about your set-up…";
export const SETUP_CHAT_BUTTON_LABEL = "Ask about your set-up";

/**
 * The phone's page for a Settings screen the assistant links to, such as
 * `/settings/providers`. Null for a screen only the computer's app has.
 */
export function phoneSettingsPage(
  pathname: string,
): "SettingsProviderAccounts" | "SettingsAppearance" | "SettingsVoice" | null {
  switch (pathname) {
    case "/settings/providers":
      return "SettingsProviderAccounts";
    case "/settings/appearance":
      return "SettingsAppearance";
    case "/settings/voice":
      return "SettingsVoice";
    default:
      return null;
  }
}
