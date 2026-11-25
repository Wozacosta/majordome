import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  CHAT_KNOWLEDGE_OTHERS_LINE,
  CHAT_KNOWLEDGE_OTHERS_TITLE,
  CHAT_KNOWLEDGE_TITLE,
  CHAT_KNOWLEDGE_TOPICS_TITLE,
  type ChatKnowledgeRow,
  chatKnowledgeView,
} from "@t3tools/shared/majordomeChatKnowledge";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { BrainIcon, CalendarIcon, FolderIcon, HashIcon, type LucideIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { majordomeEnvironment } from "../../state/majordome";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { notesLink } from "./notes.logic";

// The look of a row that opens nothing, as tall as its lines.
const LOCKED_ROW_CLASS = cn(
  THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS,
  "flex h-auto min-h-8 items-center py-1.5 sm:h-auto",
);

const ICONS: Record<ChatKnowledgeRow["kind"], LucideIcon> = {
  memory: BrainIcon,
  daily: CalendarIcon,
  topic: FolderIcon,
  "other-topic": HashIcon,
};

/**
 * What the chat was given of the notes before the first message, and which topics it only knows
 * the standing of. A row with a note opens it in Notes.
 */
export function ChatKnowledgeSection({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const result = useAtomValue(
    majordomeEnvironment.chatKnowledge({ environmentId, input: { threadId } }),
  );
  const projectId = useQuietThreadShell(scopeThreadRef(environmentId, threadId))?.projectId;
  const view = chatKnowledgeView(AsyncResult.getOrElse(result, () => null));
  if (view === null || projectId === undefined) return null;
  const row = (item: ChatKnowledgeRow) => {
    const Icon = ICONS[item.kind];
    const body = (
      <>
        <Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{item.label}</span>
          {item.detail === null ? null : (
            <span className="line-clamp-2 text-xs font-normal whitespace-normal text-muted-foreground">
              {item.detail}
            </span>
          )}
        </span>
      </>
    );
    return (
      <li key={item.key} className="flex min-w-0">
        {item.path === null ? (
          <div className={LOCKED_ROW_CLASS}>{body}</div>
        ) : (
          <ThreadDetailsControl
            size="xs"
            variant="ghost"
            part="row"
            panel
            multiline
            title={item.path}
            render={<Link {...notesLink({ projectId, environmentId, path: item.path })} />}
          >
            {body}
          </ThreadDetailsControl>
        )}
      </li>
    );
  };
  const othersTitle =
    view.starts[0]?.kind === "topic" ? CHAT_KNOWLEDGE_OTHERS_TITLE : CHAT_KNOWLEDGE_TOPICS_TITLE;
  return (
    <ThreadDetailsSection
      headingId="thread-details-chat-knowledge-heading"
      title={CHAT_KNOWLEDGE_TITLE}
      data-chat-knowledge=""
    >
      <div className="flex flex-col">
        <ul className="m-0 flex list-none flex-col p-0" aria-label="It starts with">
          {view.starts.map(row)}
        </ul>
        {view.others.length === 0 ? null : (
          <>
            <h4 className="px-2.5 pt-2 text-2xs font-medium text-muted-foreground select-none">
              {othersTitle}
            </h4>
            <p className="px-2.5 pt-0.5 pb-1 text-xs text-muted-foreground">
              {CHAT_KNOWLEDGE_OTHERS_LINE}
            </p>
            <ul className="m-0 flex list-none flex-col p-0" aria-label={othersTitle}>
              {view.others.map(row)}
            </ul>
            {view.more === 0 ? null : (
              <p className="px-2.5 pt-1 text-xs text-muted-foreground">and {view.more} more</p>
            )}
          </>
        )}
      </div>
    </ThreadDetailsSection>
  );
}
