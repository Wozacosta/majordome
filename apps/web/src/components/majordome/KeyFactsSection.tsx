import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { refreshMajordomeKeyFacts } from "@t3tools/client-runtime/state/majordome";
import type { EnvironmentId, MajordomeKeyFactKind, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { CalendarIcon, LinkIcon, type LucideIcon, MapPinIcon, UserIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useQuietThreadShell } from "../../state/entities";
import { majordomeEnvironment } from "../../state/majordome";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "../chat/threadDetailsPanelStyles";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { toastManager } from "../ui/toast";
import { DrawConversationButton } from "./ConversationDrawing";
import { keyFactGroups, type KeyFactRow } from "./keyFacts.logic";

const ICONS: Record<MajordomeKeyFactKind, LucideIcon> = {
  link: LinkIcon,
  place: MapPinIcon,
  date: CalendarIcon,
  person: UserIcon,
};

/**
 * What a conversation mentioned that is worth finding again (its links, places, dates and names)
 * and, under them, the conversation in short. Both are read by the server after each reply. A
 * link opens; anything else is copied.
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
  const thread = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const replyStamp = thread?.latestRun?.completedAt ?? null;
  const seenReplyStamp = useRef(replyStamp);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the facts are read on the server, so a finished reply asks it for them again
  useEffect(() => {
    if (seenReplyStamp.current === replyStamp) return;
    seenReplyStamp.current = replyStamp;
    refreshMajordomeKeyFacts(environmentId, appAtomRegistry);
  }, [replyStamp, environmentId, seenReplyStamp]);
  const { copyToClipboard } = useCopyToClipboard<string>({
    onCopy: (value) => toastManager.add({ type: "success", title: "Copied", description: value }),
  });

  const data = AsyncResult.getOrElse(result, () => null);
  const summary = data?.summary ?? [];
  const groups = keyFactGroups(data?.facts ?? []);
  const row = (fact: KeyFactRow) => {
    const Icon = ICONS[fact.kind];
    return (
      <li key={fact.key} className="flex min-w-0">
        <ThreadDetailsControl
          size="xs"
          variant="ghost"
          part="row"
          panel
          multiline={fact.detail !== null}
          title={fact.href === null ? `Copy ${fact.value}` : fact.value}
          {...(fact.href === null
            ? { onClick: () => copyToClipboard(fact.value, fact.value) }
            : { render: <a href={fact.href} target="_blank" rel="noreferrer" /> })}
        >
          <Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
            <span className="truncate">{fact.label}</span>
            {fact.detail === null ? null : (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {fact.detail}
              </span>
            )}
          </span>
        </ThreadDetailsControl>
      </li>
    );
  };
  return (
    <>
      <ThreadDetailsSection headingId="thread-details-key-facts-heading" title="Key facts">
        <div className="flex flex-col">
          {groups.length === 0 ? (
            <p className="px-2.5 pb-1 text-xs text-muted-foreground">
              {data === null && result.waiting
                ? "Reading this conversation…"
                : "Links, places, dates and names you mention are noted here after each reply."}
            </p>
          ) : (
            groups.map((group) => (
              <ul
                key={group.title}
                aria-label={group.title}
                className="m-0 flex list-none flex-col p-0"
              >
                {group.rows.map(row)}
              </ul>
            ))
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
