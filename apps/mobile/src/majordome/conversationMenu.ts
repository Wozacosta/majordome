import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import type { AppBarMenu } from "../components/ui/AppBar.types";
import { useThreadListActions } from "../features/home/useThreadListActions";
import { environmentServerConfigsAtom } from "../state/server";
import { conversationMenu, type ConversationMenuAction } from "./conversation.logic";

/** The menu in an open chat's header: what the list offers on a long press, without going back. */
export function useConversationMenu(thread: EnvironmentThreadShell): AppBarMenu {
  const actions = useThreadListActions();
  // Until the computer says what it supports, marking as done can only fail.
  const configLoaded = useAtomValue(environmentServerConfigsAtom).has(thread.environmentId);
  const run: Record<ConversationMenuAction, () => void> = {
    rename: () => actions.renameThread(thread),
    "mark-done": () => void actions.settleThread(thread),
    "bring-back": () => void actions.unsettleThread(thread),
    delete: () => actions.confirmDeleteThread(thread),
  };
  return {
    title: "Chat options",
    icon: "ellipsis",
    items: conversationMenu({
      done: configLoaded && thread.settledOverride === "settled",
      canMarkDone: configLoaded,
    }).map((entry) => ({
      id: entry.id,
      title: entry.title,
      icon: entry.icon,
      ...(entry.destructive ? { destructive: true } : {}),
      onPress: run[entry.id],
    })),
  };
}
