import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useQuietThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { majordomeEnvironment } from "../../state/majordome";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { machineInSentence } from "./brains.logic";
import { conversationsToMoveHome, type ConversationMove } from "./topics.logic";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";

/**
 * Moves one topic's conversation to the computer that keeps the topic's conversations: its words
 * are read where it is, handed to the home, and the copy left behind goes to the archive.
 * Resolves to the conversation's id at the home, or null when nothing was moved.
 */
export function useMoveTopicConversation(): (move: ConversationMove) => Promise<ThreadId | null> {
  const read = useAtomCommand(majordomeEnvironment.readTopicConversation, { reportFailure: false });
  const adopt = useAtomCommand(majordomeEnvironment.adoptTopicConversation, {
    reportFailure: false,
  });
  const archive = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  return async (move) => {
    const words = await read({
      environmentId: move.from.environmentId,
      input: { projectId: move.from.projectId, topicId: move.topicId },
    });
    if (
      words._tag !== "Success" ||
      words.value.threadId === null ||
      words.value.messages.length === 0
    ) {
      return null;
    }
    const adopted = await adopt({
      environmentId: move.to.environmentId,
      input: {
        projectId: move.to.projectId,
        topicId: move.topicId,
        sourceKey: `${move.from.environmentId}:${words.value.threadId}`,
        messages: words.value.messages,
      },
    });
    if (adopted._tag !== "Success") return null;
    await archive({
      environmentId: move.from.environmentId,
      input: { threadId: words.value.threadId },
    });
    return adopted.value.threadId;
  };
}

/**
 * Once this computer's notes have an always-on server, its topic conversations move there by
 * themselves, so the phone shows them. One that is still answering waits for the next look; one
 * the server refuses is tried again when the app next starts.
 */
export function useMoveTopicConversationsHome(): void {
  const { copies, vaults } = useMajordomeVaults();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const shells = useQuietThreadShells();
  const { machineOf } = useMachineNames();
  const moveConversation = useMoveTopicConversation();
  const tried = useRef(new Set<string>());
  const running = useRef(false);
  const idle = new Set(
    shells.flatMap((shell) =>
      threadRuntimeCanArchive(shell.runtime)
        ? [scopedThreadKey({ environmentId: shell.environmentId, threadId: shell.id })]
        : [],
    ),
  );
  const moves = conversationsToMoveHome(copies, vaults, primaryEnvironmentId).filter((move) =>
    idle.has(scopedThreadKey({ environmentId: move.from.environmentId, threadId: move.threadId })),
  );
  const key = JSON.stringify(moves);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks two servers to move conversations once another computer becomes their home
  useEffect(() => {
    const pending = (JSON.parse(key) as ReadonlyArray<ConversationMove>).filter(
      (move) => !tried.current.has(move.threadId),
    );
    if (pending.length === 0 || running.current) return;
    running.current = true;
    void (async () => {
      let moved = 0;
      for (const move of pending) {
        tried.current.add(move.threadId);
        if ((await moveConversation(move)) !== null) moved += 1;
      }
      running.current = false;
      if (moved === 0) return;
      const home = machineInSentence(machineOf(pending[0]!.to.environmentId));
      toastManager.add({
        type: "success",
        title:
          moved === 1
            ? `A topic's conversation moved to ${home}`
            : `${moved} topic conversations moved to ${home}`,
        description:
          "Your phone and this computer now show the same ones. The copies here are in Settings > Archived chats.",
      });
    })();
  }, [key, moveConversation, machineOf]);
}
