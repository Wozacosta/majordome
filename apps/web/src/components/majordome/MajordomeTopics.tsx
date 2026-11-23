import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { refreshMajordomeSettings } from "@t3tools/client-runtime/state/majordome";
import type { EnvironmentId, MajordomeTopicSuggestion, ThreadId } from "@t3tools/contracts";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { Link, useLocation } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderSearchIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  PlusIcon,
  RepeatIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useQuietThreadShells } from "../../state/entities";
import { registerCommands } from "../../shortcuts/dispatcher";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { onMachine } from "./brains.logic";
import { chatStatusWords, chatTitle } from "./chats.logic";
import { ChatPlaceIcon, useChatPlaceWords } from "./ChatPlaceIcon";
import { type RoutineItem, routineScheduleWords, routineTopicIds } from "./routines.logic";
import {
  reportTopicFailure as reportFailure,
  type TopicActions,
  TopicMenuItems,
  useTopicActions,
} from "./TopicHeaderActions";
import { TopicIconBadge, topicRowTint } from "./TopicIcon";
import {
  moveTopic,
  orderWithFinished,
  placeTopic,
  topicPreviewStamp,
  topicSubtitle,
  type MajordomeVault,
  type VaultTopic,
} from "./topics.logic";
import { stepAround } from "./TopicPanel.logic";
import { TopicSearchDialog } from "./TopicSearchDialog";
import { setTopicSearchOpen, useTopicSearchStore } from "./topicSearchStore";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useOpenTopic } from "./useOpenTopic";
import { useRecentChats } from "./useRecentChats";
import { useVaultRoutines } from "./useVaultRoutines";

const COLLAPSED_TOPICS = Schema.Array(Schema.String);
// A short move starts the drag, so a plain click still opens the topic.
const MOUSE_DRAG = { activationConstraint: { distance: 6 } };
// A held finger drags; a swipe still scrolls the list.
const TOUCH_DRAG = { activationConstraint: { delay: 250, tolerance: 8 } };
const TOPIC_DRAG_MODIFIERS = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];
const NO_TOPICS: ReadonlyArray<string> = [];
const QUIET_ROW_CLASS =
  "w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const HEADING_CLASS =
  "flex h-7 items-center gap-1 px-2 text-xs font-medium text-sidebar-muted-foreground";

/** The one way into the chats that belong to no topic, with how many are still going. */
function ChatsRow() {
  const active = useLocation({ select: (location) => location.pathname === "/chats" });
  const { isMobile, setOpenMobile } = useSidebar();
  const open = useRecentChats().filter((thread) => thread.settledOverride !== "settled").length;
  return (
    <Link
      to="/chats"
      aria-current={active ? "page" : undefined}
      onClick={() => {
        if (isMobile) setOpenMobile(false);
      }}
      className={cn(
        "mt-2 flex items-center gap-2.5 rounded-lg py-1.5 pr-2 pl-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-row-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active && "bg-sidebar-row-selected",
      )}
    >
      <span
        aria-hidden
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-row-hover text-sidebar-muted-foreground"
      >
        <MessagesSquareIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">Chats</span>
      {open > 0 ? (
        <span className="shrink-0 text-xs text-sidebar-muted-foreground tabular-nums">{open}</span>
      ) : null}
    </Link>
  );
}

/**
 * The owner's topics, above the recent chats: one continuing conversation each, in the owner's
 * order. Tapping one opens its chat, starting it the first time. Also offers the first topics
 * once, and switches between brains when there are several (one brain on several servers is one).
 */
export function MajordomeTopicsSection() {
  const { vaults, copies, loading, activeVault, setActiveVaultKey } = useMajordomeVaults();
  const onWelcome = useLocation({ select: (location) => location.pathname === "/" });
  if (activeVault === null) {
    return loading ? null : (
      <div className="mx-2 mb-2 flex flex-col items-start gap-2 rounded-lg border border-dashed border-sidebar-border p-3 text-xs text-sidebar-muted-foreground">
        <span>Set up your notes folder to start your topics and chats.</span>
        {onWelcome ? null : (
          <Button size="xs" variant="outline" render={<Link to="/" />}>
            Set up notes
          </Button>
        )}
      </div>
    );
  }
  return (
    <section aria-label="Topics" className="mb-1 flex flex-col gap-px">
      {vaults.length > 1 ? (
        <div className="px-1 pb-1">
          <Select
            value={activeVault.key}
            onValueChange={(key) => {
              if (typeof key === "string") setActiveVaultKey(key);
            }}
          >
            <SelectTrigger size="sm" aria-label="Notes folder">
              <SelectValue>{activeVault.title}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {vaults.map((vault) => (
                <SelectItem key={vault.key} value={vault.key}>
                  {vault.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      ) : null}
      <VaultTopics key={activeVault.key} vault={activeVault} serverCopies={copies} />
      <ChatsRow />
    </section>
  );
}

function VaultTopics({
  vault,
  serverCopies,
}: {
  readonly vault: MajordomeVault;
  /** Every server's copy of every vault, kept apart: a routine posts in its own server's chat. */
  readonly serverCopies: ReadonlyArray<MajordomeVault>;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const actions = useTopicActions(vault, {
    onCreated: (topic) =>
      open({ ...topic, threadEnvironmentId: vault.environmentId }, { justCreated: true }),
    onLeave: () => {
      if (isMobile) setOpenMobile(false);
    },
  });
  const [showFinished, setShowFinished] = useLocalStorage(
    "majordome:show-finished-topics",
    false,
    Schema.Boolean,
  );
  // The order just chosen, shown until the list read from the server changes from `from`:
  // dropping it as soon as the save answers would show the old order for a moment.
  const [pendingOrder, setPendingOrder] = useState<{
    readonly order: ReadonlyArray<string>;
    readonly from: string;
  } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_DRAG),
    useSensor(TouchSensor, TOUCH_DRAG),
  );
  // The route moves only once the chat has rendered; until then, the topic tapped shows as open.
  const [opening, setOpening] = useState<{
    readonly topicId: string;
    readonly fromRouteKey: string | null;
  } | null>(null);
  const openTopic = useOpenTopic(vault);
  const reorderTopics = useAtomCommand(majordomeEnvironment.reorderTopics, {
    label: "reorder topics",
    reportFailure: false,
  });
  const restoreSuggestions = useAtomCommand(majordomeEnvironment.dismissTopicSuggestions, {
    label: "show topic suggestions again",
    reportFailure: false,
  });
  const routeTarget = useThreadRouteTarget();
  const routeThreadKey =
    routeTarget?.kind === "server" ? scopedThreadKey(routeTarget.threadRef) : null;
  // Once the route has moved, the tap is over; kept, it would light the topic again on any later
  // page with the same route key, such as Notes or Settings, which have none.
  if (opening !== null && opening.fromRouteKey !== routeThreadKey) setOpening(null);
  const threads = useQuietThreadShells();
  const threadByKey = new Map(
    threads.map((thread) => [
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      thread,
    ]),
  );

  const { routines } = useVaultRoutines(vault);
  const routineTopics = routineTopicIds(routines, serverCopies);

  // A finished topic leaves the list, and the order being dragged, until it is asked for.
  const finished = vault.topics.filter((topic) => topic.finishedAt !== undefined);
  const unfinished = vault.topics.filter((topic) => topic.finishedAt === undefined);
  const ids = unfinished.map((topic) => topic.id);
  const idsKey = ids.join("\n");
  const order = pendingOrder !== null && pendingOrder.from === idsKey ? pendingOrder.order : ids;
  const topics = order.flatMap((id) => unfinished.find((topic) => topic.id === id) ?? []);
  const threadKeyOf = (topic: VaultTopic) =>
    topic.threadId === null
      ? null
      : scopedThreadKey(scopeThreadRef(topic.threadEnvironmentId, topic.threadId));
  const topicThread = (topic: VaultTopic) =>
    topic.threadId === null
      ? undefined
      : threadByKey.get(scopedThreadKey(scopeThreadRef(topic.threadEnvironmentId, topic.threadId)));

  const copies = vault.copies;
  // Every conversation in these notes, not only the topics': the assistant changes settings too.
  const previewStamp = topicPreviewStamp(
    threads.filter((thread) =>
      copies.some(
        (copy) =>
          copy.environmentId === thread.environmentId && copy.projectId === thread.projectId,
      ),
    ),
  );
  const seenPreviewStamp = useRef(previewStamp);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- previews and settings live on the servers, so a conversation moving on asks them again
  useEffect(() => {
    if (seenPreviewStamp.current === previewStamp) return;
    seenPreviewStamp.current = previewStamp;
    for (const copy of copies) refreshMajordomeSettings(copy.environmentId, appAtomRegistry);
  }, [previewStamp, copies, seenPreviewStamp]);

  const open = async (topic: VaultTopic, options?: { readonly justCreated: boolean }) => {
    setOpening({ topicId: topic.id, fromRouteKey: routeThreadKey });
    if (!(await openTopic(topic, options))) setOpening(null);
  };

  const searching = useTopicSearchStore((state) => state.open);
  // The topic being read, whichever of its chats is open.
  const readTopicId =
    opening?.topicId ??
    (routeThreadKey === null
      ? null
      : (topics.find(
          (topic) =>
            threadKeyOf(topic) === routeThreadKey ||
            topic.sideChats?.some((chat) => scopedThreadKey(chat) === routeThreadKey) === true,
        )?.id ?? null));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the topic keys are window shortcuts, live while the topics are listed
  useEffect(() => {
    const step = (direction: 1 | -1) => (event: KeyboardEvent) => {
      const target = stepAround(
        topics,
        topics.find((topic) => topic.id === readTopicId) ?? null,
        direction,
      );
      if (target === null) return false;
      event.preventDefault();
      event.stopPropagation();
      void open(target);
    };
    return registerCommands(
      {
        "topic.previous": step(-1),
        "topic.next": step(1),
        "topic.search": (event) => {
          event.preventDefault();
          event.stopPropagation();
          setTopicSearchOpen((shown) => !shown);
        },
      },
      { capture: true, when: () => !isCommandPaletteOpen() },
    );
  });

  const reorder = async (next: ReadonlyArray<string>) => {
    if (next === order) return;
    setPendingOrder({ order: next, from: idsKey });
    const result = await reorderTopics({
      environmentId: vault.environmentId,
      input: {
        projectId: vault.projectId,
        topicIds: [
          ...orderWithFinished(
            vault.topics.map((topic) => topic.id),
            next,
          ),
        ],
      },
    });
    if (result._tag === "Failure") {
      reportFailure("Could not reorder your topics", result);
      setPendingOrder(null);
    }
  };

  return (
    <>
      <div className={HEADING_CLASS}>
        <h2 className="min-w-0 flex-1">Topics</h2>
        {(vault.skippedSuggestions ?? 0) > 0 ? (
          <Menu>
            <MenuTrigger
              render={<Button size="icon-xs" variant="ghost-muted" aria-label="New topic" />}
            >
              <PlusIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => actions.openDialog({ kind: "create" })}>
                <PlusIcon />
                New topic
              </MenuItem>
              <MenuItem
                onClick={() => {
                  void restoreSuggestions({
                    environmentId: vault.environmentId,
                    input: { projectId: vault.projectId, restore: true },
                  }).then((result) => {
                    if (result._tag === "Failure") {
                      reportFailure("Could not bring the suggestions back", result);
                    }
                  });
                }}
              >
                <FolderSearchIcon />
                Suggest topics from my folders
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="New topic"
            onClick={() => actions.openDialog({ kind: "create" })}
          >
            <PlusIcon />
          </Button>
        )}
      </div>
      {vault.suggestions.length > 0 ? (
        <TopicSuggestions
          vault={vault}
          onCustomize={(suggestion) => actions.openDialog({ kind: "create", ...suggestion })}
        />
      ) : null}
      <TopicSearchDialog
        open={searching}
        onOpenChange={setTopicSearchOpen}
        topics={[...topics, ...finished]}
        onChoose={(topic) => void open(topic)}
      />
      {topics.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={TOPIC_DRAG_MODIFIERS}
          onDragEnd={({ active, over }: DragEndEvent) => {
            if (over !== null) void reorder(placeTopic(order, String(active.id), String(over.id)));
          }}
        >
          <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
            <ul aria-label="Topics" className="flex flex-col gap-px">
              {topics.map((topic, index) => {
                const threadKey = threadKeyOf(topic);
                const thread = topicThread(topic);
                return (
                  <TopicRow
                    key={topic.id}
                    vault={vault}
                    topic={topic}
                    thread={thread}
                    routines={routines.filter((item) => routineTopics.get(item.key) === topic.id)}
                    isActive={
                      opening !== null && opening.fromRouteKey === routeThreadKey
                        ? opening.topicId === topic.id
                        : threadKey !== null && threadKey === routeThreadKey
                    }
                    routeThreadKey={routeThreadKey}
                    sideChats={(topic.sideChats ?? []).flatMap((chat) => {
                      const shell = threadByKey.get(scopedThreadKey(chat));
                      return shell === undefined
                        ? []
                        : [
                            {
                              ...chat,
                              title: shell.title,
                              done: shell.settledOverride === "settled",
                            },
                          ];
                    })}
                    onMove={
                      topics.length < 2
                        ? null
                        : {
                            up: index > 0,
                            down: index < topics.length - 1,
                            by: (offset) => void reorder(moveTopic(order, topic.id, offset)),
                          }
                    }
                    onOpen={() => void open(topic)}
                    onNewChat={() => void openTopic(topic, { sideChat: true })}
                    actions={actions}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      ) : vault.suggestions.length === 0 ? (
        <p className="px-2 pb-1 text-xs text-sidebar-muted-foreground">
          Keep each ongoing subject here: one conversation, with its own folder of notes.
        </p>
      ) : null}
      {finished.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={showFinished}
            onClick={() => setShowFinished((shown) => !shown)}
            className={QUIET_ROW_CLASS}
          >
            {showFinished ? "Hide done" : `Show ${finished.length} done`}
          </button>
          {showFinished ? (
            <ul aria-label="Topics marked as done" className="flex flex-col gap-px">
              {finished.map((topic) => (
                <FinishedTopicRow
                  key={topic.id}
                  topic={topic}
                  isActive={threadKeyOf(topic) !== null && threadKeyOf(topic) === routeThreadKey}
                  onOpen={() => void open(topic)}
                  onNewChat={() => void openTopic(topic, { sideChat: true })}
                  actions={actions}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {actions.dialogs}
    </>
  );
}

function TopicRow(props: {
  readonly vault: MajordomeVault;
  readonly topic: VaultTopic;
  readonly thread: SidebarThreadSummary | undefined;
  /** The routines that post in this topic, listed under it. */
  readonly routines: ReadonlyArray<RoutineItem>;
  /** The other chats about this topic, apart from its conversation. */
  readonly sideChats: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly title: string;
    /** Marked as done: folded away until asked for. */
    readonly done: boolean;
  }>;
  /** The ways to move it in the list without dragging; null when it is the only topic. */
  readonly onMove: {
    readonly up: boolean;
    readonly down: boolean;
    readonly by: (offset: number) => void;
  } | null;
  readonly isActive: boolean;
  /** The conversation on screen, so the row of a chat under the topic can show it is open. */
  readonly routeThreadKey: string | null;
  readonly onOpen: () => void;
  readonly onNewChat: () => void;
  readonly actions: TopicActions;
}) {
  const { topic, thread, actions } = props;
  const nestedRowClass = (environmentId: EnvironmentId, threadId: ThreadId, quiet: boolean) => {
    const open = scopedThreadKey(scopeThreadRef(environmentId, threadId)) === props.routeThreadKey;
    return {
      "aria-current": open ? ("page" as const) : undefined,
      className: cn(
        "flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-sidebar-row-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        quiet
          ? "text-sidebar-muted-foreground hover:text-sidebar-foreground"
          : "text-sidebar-foreground",
        open && "bg-sidebar-row-selected font-medium text-sidebar-foreground",
      ),
    };
  };
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: topic.id,
  });
  const { isMobile, setOpenMobile } = useSidebar();
  const status = thread === undefined ? null : resolveThreadStatusPill({ thread });
  const activity = thread === undefined ? null : resolveThreadActivityTimestamp(thread);
  const { machineOf } = useMachineNames();
  const placeWords = useChatPlaceWords();
  // On several machines, each chat listed here says which one keeps it.
  const severalMachines = props.vault.copies.length > 1;
  const homeEnvironmentId =
    props.vault.home?.kind === "ready" ? props.vault.home.environmentId : null;
  // A routine filed here already leads to its server's chat for the topic.
  const otherChats = (topic.otherChats ?? []).filter(
    (chat) =>
      !props.routines.some(
        (item) => item.environmentId === chat.environmentId && item.task.threadId === chat.threadId,
      ),
  );
  const [collapsedTopics, setCollapsedTopics] = useLocalStorage(
    "majordome:collapsed-topics",
    NO_TOPICS,
    COLLAPSED_TOPICS,
  );
  const hasNested = props.routines.length + props.sideChats.length + otherChats.length > 0;
  const collapsed = collapsedTopics.includes(topic.id);
  const [showDone, setShowDone] = useState(false);
  const doneCount = props.sideChats.filter((chat) => chat.done).length;
  const sideChats = showDone ? props.sideChats : props.sideChats.filter((chat) => !chat.done);
  return (
    <li
      data-topic-id={topic.id}
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "group/topic relative",
        isDragging && "z-10 rounded-lg bg-sidebar shadow-lg ring-1 ring-sidebar-border",
      )}
    >
      <button
        type="button"
        {...listeners}
        onClick={props.onOpen}
        aria-current={props.isActive ? "page" : undefined}
        className={cn(
          "flex w-full cursor-pointer touch-manipulation items-center gap-2.5 rounded-lg py-1.5 pl-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-row-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          hasNested ? "pr-15" : "pr-9",
          props.isActive && topicRowTint(topic),
          isDragging && "cursor-grabbing",
        )}
      >
        <TopicIconBadge topic={topic} statusDotClass={status?.dotClass ?? null} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{topic.title}</span>
            {status !== null ? (
              <span className="sr-only">{chatStatusWords(status.label)}</span>
            ) : null}
            {activity !== null ? <ActivityLabel timestamp={activity} /> : null}
          </span>
          <span className="truncate text-xs text-sidebar-muted-foreground">
            {topicSubtitle(topic)}
          </span>
        </span>
      </button>
      <span className="absolute top-2 right-1 flex items-center">
        <Menu>
          <MenuTrigger
            render={
              <Button size="icon-xs" variant="ghost-muted" aria-label={`More for ${topic.title}`} />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <TopicMenuItems
              topic={topic}
              actions={actions}
              onNewChat={props.onNewChat}
              onMove={props.onMove}
            />
          </MenuPopup>
        </Menu>
        {hasNested ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Show" : "Hide"} routines and chats in ${topic.title}`}
            onClick={() =>
              setCollapsedTopics((ids) =>
                ids.includes(topic.id) ? ids.filter((id) => id !== topic.id) : [...ids, topic.id],
              )
            }
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          </Button>
        ) : null}
      </span>
      {hasNested && !collapsed ? (
        <ul
          aria-label={`Routines and chats in ${topic.title}`}
          className="mt-px mb-1 ml-5 flex flex-col gap-px border-l border-sidebar-border pl-2"
        >
          {props.routines.map((item) =>
            item.task.threadId === null ? null : (
              <li key={item.key}>
                <Link
                  to="/$environmentId/$threadId"
                  params={buildThreadRouteParams(
                    scopeThreadRef(item.environmentId, item.task.threadId),
                  )}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                  {...nestedRowClass(item.environmentId, item.task.threadId, true)}
                >
                  <RepeatIcon className="size-3.5 shrink-0" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sidebar-foreground">{item.task.title}</span>
                    <span className="truncate">
                      {item.task.enabled
                        ? routineScheduleWords(item.task.schedule, {
                            serverTimeZone: item.timeZone,
                          })
                        : "Off"}
                    </span>
                  </span>
                </Link>
              </li>
            ),
          )}
          {sideChats.map((chat) => (
            <li key={`${chat.environmentId}:${chat.threadId}`}>
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(scopeThreadRef(chat.environmentId, chat.threadId))}
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                }}
                title={
                  severalMachines ? `This chat is ${placeWords(chat.environmentId)}` : undefined
                }
                {...nestedRowClass(chat.environmentId, chat.threadId, false)}
              >
                {severalMachines ? (
                  <ChatPlaceIcon
                    environmentId={chat.environmentId}
                    homeEnvironmentId={homeEnvironmentId}
                    className="text-sidebar-muted-foreground"
                  />
                ) : (
                  <MessageCircleIcon
                    className="size-3.5 shrink-0 text-sidebar-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className="truncate">{chatTitle(chat.title)}</span>
              </Link>
            </li>
          ))}
          {doneCount > 0 ? (
            <li>
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone((shown) => !shown)}
                className={QUIET_ROW_CLASS}
              >
                {showDone ? "Hide done" : `Show ${doneCount} done`}
              </button>
            </li>
          ) : null}
          {otherChats.map((chat) => (
            <li key={`${chat.environmentId}:${chat.threadId}`}>
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(scopeThreadRef(chat.environmentId, chat.threadId))}
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                }}
                {...nestedRowClass(chat.environmentId, chat.threadId, true)}
              >
                <ChatPlaceIcon
                  environmentId={chat.environmentId}
                  homeEnvironmentId={homeEnvironmentId}
                />
                <span className="truncate text-sidebar-foreground">
                  Chat {onMachine(machineOf(chat.environmentId))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A topic marked as done, dimmed: its chat still opens, and its menu brings it back. */
function FinishedTopicRow(props: {
  readonly topic: VaultTopic;
  readonly isActive: boolean;
  readonly onOpen: () => void;
  readonly onNewChat: () => void;
  readonly actions: TopicActions;
}) {
  const { topic, actions } = props;
  return (
    <li data-topic-id={topic.id} className="relative">
      <button
        type="button"
        onClick={props.onOpen}
        aria-current={props.isActive ? "page" : undefined}
        className={cn(
          "flex w-full cursor-pointer touch-manipulation items-center gap-2.5 rounded-lg py-1.5 pr-9 pl-1.5 text-left text-sm text-sidebar-foreground opacity-60 hover:bg-sidebar-row-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.isActive && topicRowTint(topic),
        )}
      >
        <TopicIconBadge topic={topic} statusDotClass={null} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{topic.title}</span>
          <span className="truncate text-xs text-sidebar-muted-foreground">
            {topicSubtitle(topic)}
          </span>
        </span>
      </button>
      <span className="absolute top-2 right-1 flex items-center">
        <Menu>
          <MenuTrigger
            render={
              <Button size="icon-xs" variant="ghost-muted" aria-label={`More for ${topic.title}`} />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <TopicMenuItems topic={topic} actions={actions} onNewChat={props.onNewChat} />
          </MenuPopup>
        </Menu>
      </span>
    </li>
  );
}

// Its own component, so only the label re-renders each minute.
function ActivityLabel({ timestamp }: { readonly timestamp: string }) {
  const nowMinute = useNowMinute();
  const label = formatRelativeTimeLabel(timestamp, Date.parse(`${nowMinute}:00.000Z`));
  return (
    <span className="shrink-0 text-xs text-secondary-label tabular-nums">
      {label === "just now" ? "now" : label.replace(/ ago$/, "")}
    </span>
  );
}

/** Suggestions shown before "Show more": the most recently active folders. */
const FIRST_SUGGESTIONS = 6;
function TopicSuggestions({
  vault,
  onCustomize,
}: {
  readonly vault: MajordomeVault;
  readonly onCustomize: (suggestion: MajordomeTopicSuggestion) => void;
}) {
  const createTopic = useAtomCommand(majordomeEnvironment.createTopic, {
    label: "add a topic",
    reportFailure: false,
  });
  const dismiss = useAtomCommand(majordomeEnvironment.dismissTopicSuggestions, {
    label: "skip topic suggestions",
    reportFailure: false,
  });
  const [busy, setBusy] = useState<string | null>(null);

  const accept = async (suggestion: MajordomeTopicSuggestion) => {
    setBusy(suggestion.folder);
    const result = await createTopic({
      environmentId: vault.environmentId,
      input: {
        projectId: vault.projectId,
        title: suggestion.title,
        folder: suggestion.folder,
        createFolder: false,
      },
    });
    setBusy(null);
    if (result._tag === "Failure") reportFailure(`Could not add ${suggestion.title}`, result);
  };

  const [showAll, setShowAll] = useState(false);

  return (
    <div
      role="group"
      aria-label="Suggested topics"
      className="mx-1 mb-1 flex flex-col gap-1 rounded-lg border border-sidebar-border p-2"
    >
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 text-xs text-sidebar-muted-foreground">
          Make these folders topics?
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Hide these suggestions"
                onClick={() => {
                  void dismiss({
                    environmentId: vault.environmentId,
                    input: { projectId: vault.projectId },
                  }).then((result) => {
                    if (result._tag === "Failure")
                      reportFailure("Could not hide the suggestions", result);
                  });
                }}
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            Hide these suggestions. The + above brings them back.
          </TooltipPopup>
        </Tooltip>
      </div>
      <ul className="flex flex-col gap-0.5">
        {(showAll ? vault.suggestions : vault.suggestions.slice(0, FIRST_SUGGESTIONS)).map(
          (suggestion) => (
            <li key={suggestion.folder} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onCustomize(suggestion)}
                className="flex min-w-0 flex-1 cursor-pointer flex-col rounded-md px-1.5 py-0.5 text-left hover:bg-sidebar-row-hover"
              >
                <span className="truncate text-sm text-sidebar-foreground">{suggestion.title}</span>
                <span className="truncate text-2xs text-sidebar-muted-foreground">
                  {suggestion.folder}
                </span>
              </button>
              <Button
                size="xs"
                variant="outline"
                disabled={busy !== null}
                aria-label={`Add ${suggestion.title}`}
                onClick={() => void accept(suggestion)}
              >
                Add
              </Button>
            </li>
          ),
        )}
      </ul>
      {!showAll && vault.suggestions.length > FIRST_SUGGESTIONS ? (
        <Button
          size="xs"
          variant="ghost-muted"
          className="self-start"
          onClick={() => setShowAll(true)}
        >
          Show {vault.suggestions.length - FIRST_SUGGESTIONS} more
        </Button>
      ) : null}
    </div>
  );
}
