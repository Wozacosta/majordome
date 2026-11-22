import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { Link } from "@tanstack/react-router";
import { SquarePenIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { type ChatRow, splitChats } from "./chats.logic";
import { Disclosure, Muted, PageHeader } from "./paper";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useRecentChats } from "./useRecentChats";

/** The chats that belong to no topic, in one place, so the sidebar is left to the topics. */
export function ChatsPage() {
  const { activeVault, loading } = useMajordomeVaults();
  const chats = useRecentChats();
  const handleNewThread = useNewThreadHandler();
  const [query, setQuery] = useState("");
  const nowMs = Date.parse(`${useNowMinute()}:00.000Z`);
  const { current, earlier } = splitChats(chats, {
    query,
    isDone: (thread) => thread.settledOverride === "settled",
    activityOf: (thread) => resolveThreadActivityTimestamp(thread),
  });
  const list = (rows: ReadonlyArray<ChatRow<SidebarThreadSummary>>, label: string) => (
    <ul aria-label={label} className="m-0 list-none p-0">
      {rows.map(({ thread, at }) => {
        const status = resolveThreadStatusPill({ thread });
        return (
          <li key={`${thread.environmentId}:${thread.id}`} className="border-t border-border">
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id))}
              className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {thread.title}
              </span>
              {status === null ? null : (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className={cn("size-2 rounded-full", status.dotClass)} />
                  {status.label}
                </span>
              )}
              {at === null ? null : (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatRelativeTimeLabel(at, nowMs)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
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
                  : "Chats that aren't part of a topic. Open one to carry on, or make it a topic from its header."
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
                        : earlier.length > 0
                          ? "No chat is open. The ones you finished are below."
                          : "No chats yet. Start one with New chat."}
                    </Muted>
                  )}
                </div>
                {earlier.length > 0 ? (
                  <Disclosure summary={`Earlier (${earlier.length})`} className="mt-8">
                    {list(earlier, "Earlier chats")}
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
