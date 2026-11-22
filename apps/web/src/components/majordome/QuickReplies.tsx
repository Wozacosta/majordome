import { use, useState } from "react";

import { TimelineRowActivityCtx, TimelineRowCtx } from "../chat/timelineRowContext";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

/**
 * The answers the assistant offered at the end of its message, one tap each. They show under the
 * chat's last message only, and go once the person has answered or the assistant is working.
 */
export function QuickReplies(props: {
  readonly rowId: string;
  readonly replies: ReadonlyArray<string>;
}) {
  const { onSendAppMessage, canOperateThread } = use(TimelineRowCtx);
  const { quickRepliesRowId } = use(TimelineRowActivityCtx);
  const [sentRowId, setSentRowId] = useState<string | null>(null);
  if (
    props.replies.length === 0 ||
    quickRepliesRowId !== props.rowId ||
    sentRowId === props.rowId ||
    !onSendAppMessage ||
    !canOperateThread
  ) {
    return null;
  }
  const send = (reply: string) => {
    setSentRowId(props.rowId);
    onSendAppMessage(reply).catch(() => {
      setSentRowId(null);
      toastManager.add({ type: "error", title: "Your reply could not be sent. Try again." });
    });
  };
  return (
    <div role="group" aria-label="Quick replies" className="mt-2 flex flex-wrap gap-1.5">
      {[...new Set(props.replies)].map((reply) => (
        <Button key={reply} type="button" size="xs" variant="outline" onClick={() => send(reply)}>
          {reply}
        </Button>
      ))}
    </div>
  );
}
