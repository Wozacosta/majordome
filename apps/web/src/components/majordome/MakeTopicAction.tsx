import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { BookmarkPlusIcon, CheckIcon, FolderInputIcon, FolderOutputIcon } from "lucide-react";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TopicDialog } from "./TopicDialog";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** Lists a chat under a topic, or with no topic takes it back out; says how it went. */
export function useSetChatTopic() {
  const setThreadTopic = useAtomCommand(majordomeEnvironment.setThreadTopic, {
    label: "move a chat to a topic",
    reportFailure: false,
  });
  return async (
    chat: {
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
    },
    topic: { readonly id: string; readonly title: string } | null,
  ) => {
    const result = await setThreadTopic({
      environmentId: chat.environmentId,
      input: { projectId: chat.projectId, threadId: chat.threadId, topicId: topic?.id ?? null },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not move this chat",
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: topic === null ? "Moved to Chats, outside any topic" : `Now under ${topic.title}`,
    });
  };
}

/**
 * What a one-off chat's header offers: list it under a topic, or make it a topic of its own. Topic
 * chats, and chats outside a vault, get nothing.
 */
export function MakeTopicAction(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId;
  readonly title: string;
}) {
  // The chat's own server's copy: the topic is made where the chat is.
  const { copies } = useMajordomeVaults();
  const [open, setOpen] = useState(false);
  const setChatTopic = useSetChatTopic();
  const place = async (topic: { readonly id: string; readonly title: string } | null) => {
    if (props.projectId === null) return;
    await setChatTopic(
      {
        environmentId: props.environmentId,
        projectId: props.projectId,
        threadId: props.threadId,
      },
      topic,
    );
  };
  const vault = copies.find(
    (candidate) =>
      candidate.environmentId === props.environmentId && candidate.projectId === props.projectId,
  );
  if (vault === undefined) return null;
  if (vault.topics.some((topic) => topic.threadId === props.threadId)) return null;
  if (vault.copies.some((copy) => copy.routinesThreadId === props.threadId)) return null;
  const placedIn = vault.topics.find((topic) => topic.sideThreadIds?.includes(props.threadId));
  return (
    <>
      {vault.topics.length > 0 ? (
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      size="xs"
                      variant="ghost-muted"
                      aria-label={
                        placedIn === undefined
                          ? "Add to a topic"
                          : `In ${placedIn.title}. Move this chat`
                      }
                    />
                  }
                />
              }
            >
              <FolderInputIcon />
              <span className="max-w-40 truncate max-sm:hidden">
                {placedIn === undefined ? "Add to a topic" : `In ${placedIn.title}`}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {placedIn === undefined
                ? "List this chat under one of your topics"
                : `Listed under ${placedIn.title}. Move it to another topic or out of this one`}
            </TooltipPopup>
          </Tooltip>
          <MenuPopup align="start">
            {vault.topics
              .filter((topic) => topic.finishedAt === undefined || topic.id === placedIn?.id)
              .map((topic) => (
                <MenuItem
                  key={topic.id}
                  disabled={topic.id === placedIn?.id}
                  onClick={() => void place(topic)}
                >
                  {topic.id === placedIn?.id ? <CheckIcon /> : <FolderInputIcon />}
                  {topic.title}
                </MenuItem>
              ))}
            {placedIn === undefined ? null : (
              <>
                <MenuSeparator />
                <MenuItem onClick={() => void place(null)}>
                  <FolderOutputIcon />
                  Move out of this topic
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </Menu>
      ) : null}
      {placedIn === undefined ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="ghost-muted"
                aria-label="Make this a topic"
                onClick={() => setOpen(true)}
              />
            }
          >
            <BookmarkPlusIcon />
            <span className="max-sm:hidden">Make this a topic</span>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            Keep this chat as an ongoing topic, with its own folder of notes
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {open ? (
        <TopicDialog
          vault={vault}
          request={{ kind: "create", title: props.title, threadId: props.threadId }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
