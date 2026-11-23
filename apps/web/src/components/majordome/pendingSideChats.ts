import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import type { PendingSideChat } from "./topics.logic";

/**
 * Chats this window just started under a topic. The server's topic list names them a moment after
 * the chat opens, and until then the chat would look like one outside any topic.
 */
let pending: ReadonlyArray<
  PendingSideChat & { readonly environmentId: EnvironmentId; readonly projectId: ProjectId }
> = [];
const listeners = new Set<() => void>();

export function notePendingSideChat(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly topicId: string;
  readonly threadId: ThreadId;
}) {
  pending = [...pending, input];
  for (const listener of listeners) listener();
}

export function usePendingSideChats() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
}
