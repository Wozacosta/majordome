import { useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { SETTLE_WORDS } from "../../settleWording";
import { registerCommands } from "../../shortcuts/dispatcher";
import { useQuietThreadShells } from "../../state/entities";
import { majordomeEnvironment } from "../../state/majordome";
import { buildThreadRouteParams } from "../../threadRoutes";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { onMachine } from "./brains.logic";
import { stepAround, topicTabs } from "./TopicPanel.logic";
import type { VaultTopic } from "./topics.logic";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useOpenTopic } from "./useOpenTopic";

const TAB_CLASS =
  "flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-[current=page]:font-medium aria-[current=page]:text-foreground";
const TAB_BOX_CLASS = "flex max-w-48 shrink-0 items-center rounded-md hover:bg-accent";

/**
 * A topic's chats as a row of tabs under the header of any of them: its continuing chat first,
 * then its other chats, then a way to start one more. Nothing for a chat outside a topic.
 */
export function TopicTabs(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  // The chat's own server's copy says which topic it belongs to; new chats start at the home.
  const { copies, vaults } = useMajordomeVaults();
  for (const copy of copies) {
    if (copy.environmentId !== props.environmentId) continue;
    const topic = copy.topics.find(
      (candidate) =>
        candidate.threadId === props.threadId ||
        candidate.sideThreadIds?.includes(props.threadId) === true,
    );
    if (topic === undefined) continue;
    const vault = vaults.find((candidate) =>
      candidate.copies.some(
        (other) => other.environmentId === copy.environmentId && other.projectId === copy.projectId,
      ),
    );
    return (
      <TopicTabStrip
        environmentId={props.environmentId}
        projectId={copy.projectId}
        threadId={props.threadId}
        topic={topic}
        merged={vault?.topics.find((candidate) => candidate.id === topic.id)}
        homeEnvironmentId={
          vault?.home?.kind === "ready" ? vault.home.environmentId : props.environmentId
        }
      />
    );
  }
  return null;
}

function TopicTabStrip(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly topic: VaultTopic;
  /** The topic across every computer that has it, when known. */
  readonly merged: VaultTopic | undefined;
  /** The computer a new chat about the topic starts on. */
  readonly homeEnvironmentId: EnvironmentId;
}) {
  const { environmentId, projectId, threadId, topic } = props;
  // Its `threadId` is the home's, so opening it starts the main chat there when there is none.
  const homeTopic = props.merged ?? topic;
  const shells = useQuietThreadShells();
  const navigate = useNavigate();
  const { machineOf } = useMachineNames();
  const canStart = useAtomValue(
    majordomeEnvironment.openTopic.permissionAtom(props.homeEnvironmentId),
  );
  const openTopic = useOpenTopic({ environmentId, projectId });
  const { settleThread } = useThreadActions();
  const [starting, setStarting] = useState(false);
  const shellByKey = new Map(
    shells.map((shell) => [scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)), shell]),
  );
  const currentKey = scopedThreadKey({ environmentId, threadId });
  const tabs = topicTabs({
    own: topic,
    merged: props.merged,
    current: { environmentId, threadId },
    shellOf: (chat) => shellByKey.get(scopedThreadKey(chat)),
  });
  const { main } = tabs;
  // The tabs as shown, by key, for the keys that step through them.
  const tabOrder = [...(main === null ? [] : [main]), ...tabs.chats, ...tabs.elsewhere]
    .map((chat) => scopedThreadKey(chat))
    .join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the tab keys are window shortcuts, live while these tabs show
  useEffect(() => {
    const step = (direction: 1 | -1) => (event: KeyboardEvent) => {
      const key = stepAround(tabOrder.split("\n"), currentKey, direction);
      const target = key === null ? null : parseScopedThreadKey(key);
      if (target === null) return false;
      event.preventDefault();
      event.stopPropagation();
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target),
      });
    };
    // Capture phase: the message box would otherwise keep Tab for itself.
    return registerCommands(
      { "topic.previousChat": step(-1), "topic.nextChat": step(1) },
      { capture: true, when: () => !isCommandPaletteOpen() },
    );
  }, [tabOrder, currentKey, navigate]);
  const dot = (chat: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId }) => {
    const shell = shellByKey.get(scopedThreadKey(chat));
    const status = shell === undefined ? null : resolveThreadStatusPill({ thread: shell });
    return status === null ? null : (
      <>
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)} />
        <span className="sr-only">{status.label}</span>
      </>
    );
  };

  const close = async (chat: (typeof tabs.chats)[number]) => {
    const result = await settleThread(scopeThreadRef(chat.environmentId, chat.threadId));
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: SETTLE_WORDS.settleFailed,
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (scopedThreadKey(chat) !== currentKey) return;
    if (main === null) {
      void openTopic(homeTopic);
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(main.environmentId, main.threadId)),
    });
  };

  return (
    <nav
      aria-label={`Chats in ${topic.title}`}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background [scrollbar-width:none]",
        isElectron ? "px-3 sm:px-5" : "pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)",
      )}
    >
      <ul className="m-0 flex list-none items-center gap-1 p-0">
        <li
          className={cn(
            TAB_BOX_CLASS,
            main !== null && scopedThreadKey(main) === currentKey && "bg-accent",
          )}
        >
          {main === null ? (
            <button type="button" className={TAB_CLASS} onClick={() => void openTopic(homeTopic)}>
              Main
            </button>
          ) : (
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(main.environmentId, main.threadId))}
              aria-current={scopedThreadKey(main) === currentKey ? "page" : undefined}
              className={TAB_CLASS}
            >
              {dot(main)}
              Main
            </Link>
          )}
        </li>
        {tabs.chats.map((chat) => {
          const current = scopedThreadKey(chat) === currentKey;
          return (
            <li key={scopedThreadKey(chat)} className={cn(TAB_BOX_CLASS, current && "bg-accent")}>
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(scopeThreadRef(chat.environmentId, chat.threadId))}
                aria-current={current ? "page" : undefined}
                title={chat.title}
                className={TAB_CLASS}
              >
                {dot(chat)}
                <span className="truncate">{chat.title}</span>
              </Link>
              {chat.done ? null : (
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={`${SETTLE_WORDS.settleThread}: ${chat.title}`}
                  title={SETTLE_WORDS.settleThread}
                  className="mr-1 shrink-0"
                  onClick={() => void close(chat)}
                >
                  <XIcon />
                </Button>
              )}
            </li>
          );
        })}
        {tabs.elsewhere.map((chat) => {
          const current = scopedThreadKey(chat) === currentKey;
          const title = `Chat ${onMachine(machineOf(chat.environmentId))}`;
          return (
            <li key={scopedThreadKey(chat)} className={cn(TAB_BOX_CLASS, current && "bg-accent")}>
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(scopeThreadRef(chat.environmentId, chat.threadId))}
                aria-current={current ? "page" : undefined}
                title={title}
                className={TAB_CLASS}
              >
                {dot(chat)}
                <span className="truncate">{title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {canStart ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="New chat about this"
                disabled={starting}
                className="shrink-0"
                onClick={() => {
                  setStarting(true);
                  void openTopic(homeTopic, { sideChat: true }).finally(() => setStarting(false));
                }}
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">New chat about this, starting from its notes</TooltipPopup>
        </Tooltip>
      ) : null}
    </nav>
  );
}
