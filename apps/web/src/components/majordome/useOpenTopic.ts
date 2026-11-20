import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
import type { MajordomeVault, VaultTopic } from "./topics.logic";

/**
 * Opens a topic's conversation, starting it the first time. Resolves false, after saying why, when
 * the conversation could not be started.
 */
export function useOpenTopic({ topicsCopy }: Pick<MajordomeVault, "topicsCopy">) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic, {
    label: "open a topic",
    reportFailure: false,
  });

  const goToThread = (environmentId: EnvironmentId, threadId: ThreadId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  return async (topic: VaultTopic): Promise<boolean> => {
    if (topic.threadId !== null) {
      goToThread(topic.threadEnvironmentId, topic.threadId);
      return true;
    }
    const result = await openTopic({
      environmentId: topicsCopy.environmentId,
      input: { projectId: topicsCopy.projectId, topicId: topic.id },
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
    goToThread(topicsCopy.environmentId, result.value.threadId);
    return true;
  };
}
