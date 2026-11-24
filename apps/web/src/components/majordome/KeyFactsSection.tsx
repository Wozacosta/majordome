import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { refreshMajordomeKeyFacts } from "@t3tools/client-runtime/state/majordome";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useQuietThreadShell } from "../../state/entities";
import { majordomeEnvironment } from "../../state/majordome";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { Button } from "../ui/button";
import { DrawConversationButton } from "./ConversationDrawing";
import { KeyFactRows } from "./KeyFactRow";
import { firstKeyFacts, keyFactGroups, localDay } from "./keyFacts.logic";

/**
 * The conversation in short and, over it, the few key facts worth a glance: what is coming, then
 * the latest links, places and names. The full list opens beside the chat. Both are read by the
 * server after each reply.
 */
export function KeyFactsSection({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const result = useAtomValue(
    majordomeEnvironment.keyFacts({ environmentId, input: { threadId } }),
  );
  const threadRef = scopeThreadRef(environmentId, threadId);
  const thread = useQuietThreadShell(threadRef);
  const replyStamp = thread?.latestRun?.completedAt ?? null;
  const seenReplyStamp = useRef(replyStamp);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the facts are read on the server, so a finished reply asks it for them again
  useEffect(() => {
    if (seenReplyStamp.current === replyStamp) return;
    seenReplyStamp.current = replyStamp;
    refreshMajordomeKeyFacts(environmentId, appAtomRegistry);
  }, [replyStamp, environmentId, seenReplyStamp]);
  const [today] = useState(() => localDay(new Date()));

  const data = AsyncResult.getOrElse(result, () => null);
  const summary = data?.summary ?? [];
  const total = data?.facts.length ?? 0;
  const first = firstKeyFacts(keyFactGroups(data?.facts ?? [], { today }));
  return (
    <>
      <ThreadDetailsSection
        headingId="thread-details-key-facts-heading"
        title="Key facts"
        actions={
          total === 0 ? undefined : (
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => useRightPanelStore.getState().open(threadRef, "key-facts")}
            >
              {first.remaining === 0 ? "Search" : `All ${total}`}
            </Button>
          )
        }
      >
        <div className="flex flex-col">
          {total === 0 ? (
            <p className="px-2.5 pb-1 text-xs text-muted-foreground">
              {data === null && result.waiting
                ? "Reading this chat…"
                : "Links, places, dates and names you mention are noted here after each reply."}
            </p>
          ) : first.rows.length === 0 ? (
            <p className="px-2.5 pb-1 text-xs text-muted-foreground">Nothing coming up.</p>
          ) : (
            <KeyFactRows label="Key facts" rows={first.rows} />
          )}
        </div>
      </ThreadDetailsSection>
      <ThreadDetailsSection
        headingId="thread-details-in-short-heading"
        title="In short"
        actions={
          <DrawConversationButton
            environmentId={environmentId}
            threadId={threadId}
            saved={data?.diagram ?? null}
          />
        }
      >
        <div>
          {summary.length === 0 ? null : (
            <ul className="m-0 flex list-disc flex-col gap-1 py-0 pr-2.5 pl-6 text-xs text-foreground/85">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </ThreadDetailsSection>
    </>
  );
}
