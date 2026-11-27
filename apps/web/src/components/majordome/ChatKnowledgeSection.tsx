import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { START_ABOUT_YOU_LABEL } from "@t3tools/shared/majordome";
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
import {
  BrainIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  HashIcon,
  type LucideIcon,
  UserIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { useStartAboutYou } from "./useStartAboutYou";
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
  me: UserIcon,
  daily: CalendarIcon,
  topic: FolderIcon,
  "other-topic": HashIcon,
};

/**
 * What the chat was given of the notes before the first message, and which topics it only knows
 * the standing of, folded until asked for. A row with a note opens it in Notes.
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
  const [othersOpen, setOthersOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const view = chatKnowledgeView(AsyncResult.getOrElse(result, () => null));
  const startAboutYou = useStartAboutYou();
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
        {item.canStart ? (
          <ThreadDetailsControl
            size="xs"
            variant="ghost"
            part="row"
            panel
            multiline
            onClick={() => void startAboutYou(scopeProjectRef(environmentId, projectId))}
          >
            {body}
            <span className="shrink-0 text-xs font-medium text-primary">
              {START_ABOUT_YOU_LABEL}
            </span>
          </ThreadDetailsControl>
        ) : item.path === null ? (
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
  const OthersChevron = othersOpen ? ChevronDownIcon : ChevronRightIcon;
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
            <ThreadDetailsControl
              size="xs"
              variant="ghost"
              part="row"
              panel
              tone="muted"
              aria-expanded={othersOpen}
              aria-controls="thread-details-chat-knowledge-others"
              onClick={() => setOthersOpen((open) => !open)}
            >
              <OthersChevron className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">
                {othersTitle} ({view.others.length + view.rest.length})
              </span>
            </ThreadDetailsControl>
            {othersOpen ? (
              <div id="thread-details-chat-knowledge-others" className="flex flex-col">
                <p className="px-2.5 pt-0.5 pb-1 text-xs text-muted-foreground">
                  {CHAT_KNOWLEDGE_OTHERS_LINE}
                </p>
                <ul className="m-0 flex list-none flex-col p-0" aria-label={othersTitle}>
                  {view.others.map(row)}
                  {restOpen ? view.rest.map(row) : null}
                </ul>
                {view.rest.length === 0 ? null : (
                  <ThreadDetailsControl
                    size="xs"
                    variant="ghost"
                    part="row"
                    panel
                    tone="muted"
                    aria-expanded={restOpen}
                    onClick={() => setRestOpen((open) => !open)}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {restOpen ? "Show fewer" : `and ${view.rest.length} more`}
                    </span>
                  </ThreadDetailsControl>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </ThreadDetailsSection>
  );
}
