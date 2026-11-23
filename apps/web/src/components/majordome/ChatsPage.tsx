import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { EllipsisIcon, SquarePenIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadActionMenu } from "../../hooks/useThreadActionMenu";
import { cn } from "../../lib/utils";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { canShareWithGuestAtom } from "../chat/guestShareAvailability";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  type ChatRow,
  chatStatusWords,
  chatTitle,
  renamedChatTitle,
  splitChats,
} from "./chats.logic";
import { useSetChatTopic } from "./MakeTopicAction";
import { Disclosure, Muted, PageHeader } from "./paper";
import type { MajordomeVault } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useRecentChats } from "./useRecentChats";

const NO_TOPICS: MajordomeVault["topics"] = [];

/** One chat: opens on a click, and its "…" holds what can be done to it without opening it. */
function ChatListRow({
  thread,
  at,
  nowMs,
  topics,
}: ChatRow<SidebarThreadSummary> & {
  readonly nowMs: number;
  /** The topics this chat can be listed under: those of its own computer's copy of the notes. */
  readonly topics: MajordomeVault["topics"];
}) {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const title = chatTitle(thread.title);
  const [renaming, setRenaming] = useState(false);
  const canChange = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const canShareWithGuest = useAtomValue(canShareWithGuestAtom(thread.environmentId));
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const setChatTopic = useSetChatTopic();
  const { openMenu } = useThreadActionMenu({
    threadRef,
    projectCwd: null,
    onStartRename: () => setRenaming(true),
    canShareWithGuest,
    extraItems:
      canChange && topics.length > 0
        ? [
            {
              id: "extra:topic",
              label: "Add to a topic",
              icon: "folder-plus",
              children: topics.map((topic) => ({
                id: `extra:topic:${topic.id}` as const,
                label: topic.title,
              })),
            },
          ]
        : undefined,
    onExtraAction: (id) => {
      const topic = topics.find((candidate) => `extra:topic:${candidate.id}` === id);
      if (topic === undefined) return;
      void setChatTopic(
        { environmentId: thread.environmentId, projectId: thread.projectId, threadId: thread.id },
        topic,
      );
    },
  });
  const rename = (typed: string) => {
    setRenaming(false);
    const next = renamedChatTitle(typed, thread.title);
    if (next === null) return;
    void updateThreadMetadata({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, title: next },
    }).then((result) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not rename the chat",
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };
  const status = resolveThreadStatusPill({ thread });
  return (
    <li
      className="flex items-center gap-1 border-t border-border"
      onContextMenu={(event) => {
        if (renaming) return;
        event.preventDefault();
        openMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {renaming ? (
        <div className="min-w-0 flex-1 py-1.5">
          <Input
            nativeInput
            autoFocus
            aria-label="Chat title"
            defaultValue={title}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => rename(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key !== "Escape") return;
              // Removing a focused field can still blur it; put back the title so nothing saves.
              event.currentTarget.value = title;
              setRenaming(false);
            }}
          />
        </div>
      ) : (
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(threadRef)}
          className="-ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {status === null ? null : (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className={cn("size-2 rounded-full", status.dotClass)} />
              {chatStatusWords(status.label)}
            </span>
          )}
          {at === null ? null : (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatRelativeTimeLabel(at, nowMs)}
            </span>
          )}
        </Link>
      )}
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={`More for ${title}`}
        aria-haspopup="menu"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <EllipsisIcon />
      </Button>
    </li>
  );
}

/** The chats that belong to no topic, in one place, so the sidebar is left to the topics. */
export function ChatsPage() {
  const { activeVault, copies, loading } = useMajordomeVaults();
  const chats = useRecentChats();
  const handleNewThread = useNewThreadHandler();
  const [query, setQuery] = useState("");
  const nowMs = Date.parse(`${useNowMinute()}:00.000Z`);
  const { current, done } = splitChats(chats, {
    query,
    isDone: (thread) => thread.settledOverride === "settled",
    activityOf: (thread) => resolveThreadActivityTimestamp(thread),
  });
  const list = (rows: ReadonlyArray<ChatRow<SidebarThreadSummary>>, label: string) => (
    <ul aria-label={label} className="m-0 list-none p-0">
      {rows.map(({ thread, at }) => (
        <ChatListRow
          key={`${thread.environmentId}:${thread.id}`}
          thread={thread}
          at={at}
          nowMs={nowMs}
          topics={
            copies
              .find(
                (copy) =>
                  copy.environmentId === thread.environmentId &&
                  copy.projectId === thread.projectId,
              )
              ?.topics.filter((topic) => topic.finishedAt === undefined) ?? NO_TOPICS
          }
        />
      ))}
    </ul>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border" />
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-6 pb-12 sm:px-6">
            <PageHeader
              title="Chats"
              intro={
                activeVault === null && !loading
                  ? "Open a notes folder to see its chats."
                  : "Chats that aren't part of a topic. Open one to carry on, or use its … to rename it, mark it as done or add it to a topic."
              }
              action={
                activeVault === null ? undefined : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void handleNewThread(
                        scopeProjectRef(activeVault.environmentId, activeVault.projectId),
                      )
                    }
                  >
                    <SquarePenIcon />
                    New chat
                  </Button>
                )
              }
            />
            {activeVault === null ? null : (
              <>
                {chats.length > 6 || query !== "" ? (
                  <div className="mt-6">
                    <Input
                      nativeInput
                      type="search"
                      aria-label="Find a chat by its title"
                      placeholder="Find a chat"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                ) : null}
                <div className="mt-6">
                  {current.length > 0 ? (
                    list(current, "Chats")
                  ) : (
                    <Muted className="border-t border-border py-3">
                      {query !== ""
                        ? "No chat has that in its title."
                        : done.length > 0
                          ? "No chat is open. The ones marked as done are below."
                          : "No chats yet. Start one with New chat."}
                    </Muted>
                  )}
                </div>
                {done.length > 0 ? (
                  <Disclosure summary={`Done (${done.length})`} className="mt-8">
                    {list(done, "Chats marked as done")}
                  </Disclosure>
                ) : null}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
