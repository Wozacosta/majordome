import { useAtomValue } from "@effect/atom-react";
import { parseTopicHref } from "@t3tools/shared/majordomeTopicLinks";
import * as Haptics from "expo-haptics";

import { useSelectWorkspaceDetail } from "../features/layout/workspace/useSelectWorkspaceDetail";
import { useAtomCommand } from "../state/use-atom-command";
import { majordomeEnvironment } from "./state";
import { todayStoreAtom } from "./todayStore";
import { useVault } from "./useVault";

/**
 * The topics a message's links can name, and how to open one. `open` is false for a link that
 * names no topic; a topic this phone does not list is a link that does nothing.
 */
export function useTopicLinks() {
  // Asked of the server, not only read from the phone's copy, which Today alone fills.
  const { vault, topics } = useVault(useAtomValue(todayStoreAtom));
  const selectDetail = useSelectWorkspaceDetail();
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic);
  const open = (href: string): boolean => {
    const topicId = parseTopicHref(href);
    if (topicId === null) return false;
    const topic = topics.find((row) => row.id === topicId);
    if (topic === undefined || vault === null) return true;
    void Haptics.selectionAsync();
    const show = (threadId: string) =>
      selectDetail({
        name: "Thread",
        params: { environmentId: String(vault.environmentId), threadId },
      });
    if (topic.threadId !== null) {
      show(topic.threadId);
      return true;
    }
    // A topic never opened on this server has no conversation yet; the server starts it.
    void openTopic({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, topicId },
    }).then((result) => {
      if (result._tag === "Success") show(String(result.value.threadId));
    });
    return true;
  };
  return { topics, open };
}
