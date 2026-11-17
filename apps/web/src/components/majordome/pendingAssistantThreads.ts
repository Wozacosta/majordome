import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

/**
 * Assistant conversations this window asked a server to start. The server's list of them arrives
 * after the conversation itself, and until then it would show as a row among the recent chats.
 */
let keys: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function notePendingAssistantThread(environmentId: EnvironmentId, threadId: ThreadId) {
  keys = new Set([...keys, scopedThreadKey({ environmentId, threadId })]);
  for (const listener of listeners) listener();
}

export function usePendingAssistantThreadKeys(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => keys,
  );
}
