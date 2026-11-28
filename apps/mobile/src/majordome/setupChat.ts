import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import type { ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useMemo, useRef } from "react";

import { appAtomRegistry } from "../state/atom-registry";
import { useProjects } from "../state/entities";
import { startOpeningEnvironmentThread } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { findSetupChats, isSetupChat, type SetupChatRef } from "./setupChat.logic";
import { majordomeEnvironment, vaultTopicsAtom } from "./state";

export {
  phoneSettingsPage,
  SETUP_CHAT_BUTTON_LABEL,
  SETUP_CHAT_PLACEHOLDER,
} from "./setupChat.logic";

/** Each reachable computer's Set-up chat. Empty when none of them knows it. */
function useSetupChats(): ReadonlyArray<SetupChatRef> {
  const projects = useProjects().filter((project) => !project.archivedAt && !project.isScratch);
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const results = useAtomValue(vaultTopicsAtom(key));
  const chatsKey = JSON.stringify(
    findSetupChats(
      projects,
      results.map((result) => AsyncResult.getOrElse(result, () => null)),
    ),
  );
  // The same chats by value keep one identity, so what is drawn from them is not redrawn.
  return useMemo(() => JSON.parse(chatsKey) as ReadonlyArray<SetupChatRef>, [chatsKey]);
}

/**
 * Opens the one continuing Set-up chat, over the page that asked, so Back returns there. The
 * computer starts it the first time. Null when no reachable computer has such a chat (an older
 * Majordome, or none connected): show no button then.
 */
export function useOpenSetupChat(): (() => void) | null {
  const navigation = useNavigation();
  const chat = useSetupChats()[0];
  const start = useAtomCommand(majordomeEnvironment.openSetupConversation);
  const starting = useRef(false);
  if (chat === undefined) return null;
  const show = (threadId: ThreadId) => {
    startOpeningEnvironmentThread(chat.environmentId, threadId);
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(chat.environmentId),
        threadId: String(threadId),
      }),
    );
  };
  return () => {
    if (chat.threadId !== null) {
      void Haptics.selectionAsync();
      show(chat.threadId);
      return;
    }
    // Read at the tap: the computer refuses a phone that may not start chats there anyway.
    if (
      starting.current ||
      !appAtomRegistry.get(
        majordomeEnvironment.openSetupConversation.permissionAtom(chat.environmentId),
      )
    ) {
      return;
    }
    starting.current = true;
    void Haptics.selectionAsync();
    void start({ environmentId: chat.environmentId, input: { projectId: chat.projectId } }).then(
      (result) => {
        starting.current = false;
        if (result._tag === "Success") show(result.value.threadId);
      },
    );
  };
}

/** Whether this chat is a computer's Set-up chat, which has its own way in from Settings. */
export function useIsSetupChat(environmentId: string, threadId: string): boolean {
  return isSetupChat(useSetupChats(), environmentId, threadId);
}

/**
 * The Set-up chats as `environmentId:threadId`, for the home list to leave out: the chat is
 * reached from Settings, not listed among the others.
 */
export function useSetupChatKeys(): ReadonlySet<string> {
  const chats = useSetupChats();
  return useMemo(
    () =>
      new Set(
        chats.flatMap((chat) =>
          chat.threadId === null ? [] : [`${chat.environmentId}:${chat.threadId}`],
        ),
      ),
    [chats],
  );
}
