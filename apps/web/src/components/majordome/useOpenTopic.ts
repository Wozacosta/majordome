import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useSidebar } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { conversationHomeRef } from "./conversationHome";
import type { MajordomeVault, VaultTopic } from "./topics.logic";

/**
 * Opens a topic's conversation, starting it the first time, or with `sideChat` starts another chat
 * about the topic. A conversation is started on the notes folder's home, whichever copy `vault`
 * is. Resolves false, after saying why, when the conversation could not be started.
 */
export function useOpenTopic(vault: Pick<MajordomeVault, "environmentId" | "projectId">) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic, {
    label: "open a topic",
    reportFailure: false,
  });
  const syncNotes = useAtomCommand(majordomeEnvironment.backUpNow, {
    label: "send a new topic to the always-on server",
    reportFailure: false,
  });

  const goToThread = (environmentId: EnvironmentId, threadId: ThreadId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  return async (
    topic: VaultTopic,
    options?: {
      readonly sideChat?: boolean;
      /** The topic was made on `vault` a moment ago, so another computer has not heard of it. */
      readonly justCreated?: boolean;
    },
  ): Promise<boolean> => {
    const sideChat = options?.sideChat === true;
    if (topic.threadId !== null && !sideChat) {
      goToThread(topic.threadEnvironmentId, topic.threadId);
      return true;
    }
    const home = conversationHomeRef(scopeProjectRef(vault.environmentId, vault.projectId));
    if (home === null) return false;
    if (options?.justCreated === true && home.environmentId !== vault.environmentId) {
      // The topic list travels with the notes; opening says what went wrong if this did not work.
      await syncNotes({
        environmentId: vault.environmentId,
        input: { projectId: vault.projectId },
      });
    }
    const result = await openTopic({
      environmentId: home.environmentId,
      input: { projectId: home.projectId, topicId: topic.id, ...(sideChat ? { sideChat } : {}) },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: `Could not open ${topic.title}`,
          description: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
    goToThread(home.environmentId, result.value.threadId);
    return true;
  };
}
