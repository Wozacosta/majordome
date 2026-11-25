import type { ScopedThreadRef } from "@t3tools/contracts";

import { isMajordome } from "../../env";
import { topicOfThread } from "./topicFiles.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

function useFolder(threadRef: ScopedThreadRef | null): string | null {
  const { copies } = useMajordomeVaults();
  if (threadRef === null) return null;
  return topicOfThread(copies, threadRef.environmentId, threadRef.threadId)?.topic.folder ?? null;
}

/** The folder of the topic a chat belongs to, relative to the notes folder; null for any other chat. */
export const useTopicFolderOfThread: (threadRef: ScopedThreadRef | null) => string | null =
  isMajordome ? useFolder : () => null;
