import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { BookmarkPlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TopicDialog } from "./TopicDialog";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** "Make this a topic" in a one-off chat's header. Topic chats, and chats outside a vault, get nothing. */
export function MakeTopicAction(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId;
  readonly title: string;
}) {
  // The chat's own server's copy: the topic is made where the chat is.
  const { copies } = useMajordomeVaults();
  const [open, setOpen] = useState(false);
  const vault = copies.find(
    (candidate) =>
      candidate.environmentId === props.environmentId && candidate.projectId === props.projectId,
  );
  if (vault === undefined) return null;
  if (vault.topics.some((topic) => topic.threadId === props.threadId)) return null;
  return (
    <>
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
