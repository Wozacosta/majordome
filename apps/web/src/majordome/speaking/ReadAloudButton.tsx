import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useGT, useLocale } from "gt-react";
import { EllipsisIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { memo, use, useEffect, useSyncExternalStore } from "react";

import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { setReadAloudAppLanguage } from "./appLanguage";
import { readAloudReplyKey } from "./keys";
import type { ReadAloudRuntime } from "./runtime";
import { useReadAloud } from "./useReadAloud";

/** "Read aloud" under a reply; "Stop" while that reply is being read. */
export const ReadAloudButton = memo(function ReadAloudButton(props: {
  readonly replyId: string;
  readonly markdown: string;
  /** When the reply was written; the newest reply on screen answers the shortcut. */
  readonly at: string;
}) {
  const runtime = useReadAloud();
  const { threadRef } = use(TimelineRowCtx);
  if (!runtime || !props.markdown.trim()) return null;
  const chat = threadRef ? scopedThreadKey(threadRef) : "draft";
  return (
    <ReplyButton
      runtime={runtime}
      chat={chat}
      replyKey={readAloudReplyKey(chat, props.replyId)}
      markdown={props.markdown}
      at={props.at}
    />
  );
});

function ReplyButton(props: {
  readonly runtime: ReadAloudRuntime;
  readonly chat: string;
  readonly replyKey: string;
  readonly markdown: string;
  readonly at: string;
}) {
  const { runtime, chat, replyKey, markdown, at } = props;
  const gt = useGT();
  const locale = useLocale();
  const active = useSyncExternalStore(runtime.controller.subscribe, () =>
    runtime.controller.isActive(replyKey),
  );
  const sounding = useSyncExternalStore(runtime.sounding.subscribe, runtime.sounding.get);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the shortcut and the command palette which replies are on screen
  useEffect(
    () => runtime.replies.show({ key: replyKey, chat, markdown, at }),
    [runtime, replyKey, chat, markdown, at],
  );

  const label = !active
    ? gt("Read aloud")
    : sounding
      ? gt("Stop", { $context: "stop reading aloud" })
      : gt("Preparing the voice");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            aria-label={label}
            aria-pressed={active}
            onClick={() => {
              setReadAloudAppLanguage(locale);
              void runtime.toggle({ key: replyKey, markdown }, chat);
            }}
          />
        }
      >
        {!active ? <Volume2Icon /> : sounding ? <SquareIcon /> : <EllipsisIcon />}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
