import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { refreshMajordomeSettings } from "@t3tools/client-runtime/state/majordome";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  MajordomeTopic,
  MajordomeTopicSuggestion,
  ThreadId,
} from "@t3tools/contracts";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderInputIcon,
  FolderSearchIcon,
  MessageCircleIcon,
  MessageCirclePlusIcon,
  NotebookTextIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  ShapesIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useQuietThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useSidebar } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { notesLink } from "./notes.logic";
import { type RoutineItem, routineScheduleWords, routineTopicIds } from "./routines.logic";
import { TopicDialog, type TopicDialogRequest } from "./TopicDialog";
import { TopicIconBadge, TopicIconDialog, topicRowTint } from "./TopicIcon";
import {
  moveTopic,
  placeTopic,
  topicPreviewStamp,
  topicSubtitle,
  type MajordomeVault,
  type VaultTopic,
} from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useOpenTopic } from "./useOpenTopic";
import { useVaultRoutines } from "./useVaultRoutines";

const COLLAPSED_TOPICS = Schema.Array(Schema.String);
const NO_TOPICS: ReadonlyArray<string> = [];

const HEADING_CLASS =
  "flex h-7 items-center gap-1 px-2 text-xs font-medium text-sidebar-muted-foreground";

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
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
      <h2 className={cn(HEADING_CLASS, "mt-2")}>Recent</h2>
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
  const [dialog, setDialog] = useState<TopicDialogRequest | null>(null);
  const [removing, setRemoving] = useState<MajordomeTopic | null>(null);
  const [choosingIcon, setChoosingIcon] = useState<MajordomeTopic | null>(null);
  const [pendingOrder, setPendingOrder] = useState<ReadonlyArray<string> | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
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

  const ids = vault.topics.map((topic) => topic.id);
  const order = pendingOrder ?? ids;
  const topics = order.flatMap((id) => vault.topics.find((topic) => topic.id === id) ?? []);
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

  const open = async (topic: VaultTopic) => {
    setOpening({ topicId: topic.id, fromRouteKey: routeThreadKey });
    if (!(await openTopic(topic))) setOpening(null);
  };

  const reorder = async (next: ReadonlyArray<string>) => {
    if (next === order) return;
    setPendingOrder(next);
    const result = await reorderTopics({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, topicIds: [...next] },
    });
    if (result._tag === "Failure") reportFailure("Could not reorder your topics", result);
    setPendingOrder(null);
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
              <MenuItem onClick={() => setDialog({ kind: "create" })}>
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
            onClick={() => setDialog({ kind: "create" })}
          >
            <PlusIcon />
          </Button>
        )}
      </div>
      {vault.suggestions.length > 0 ? (
        <TopicSuggestions
          vault={vault}
          onCustomize={(suggestion) => setDialog({ kind: "create", ...suggestion })}
        />
      ) : null}
      {topics.length > 0 ? (
        <ul aria-label="Topics" className="flex flex-col gap-px">
          {topics.map((topic, index) => {
            const threadKey =
              topic.threadId === null
                ? null
                : scopedThreadKey(scopeThreadRef(topic.threadEnvironmentId, topic.threadId));
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
                isDragging={dragging === topic.id}
                sideChats={(topic.sideChats ?? []).flatMap((chat) => {
                  const shell = threadByKey.get(scopedThreadKey(chat));
                  return shell === undefined
                    ? []
                    : [{ ...chat, title: shell.title, done: shell.settledOverride === "settled" }];
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
                onDragStart={() => setDragging(topic.id)}
                onDragEnd={() => setDragging(null)}
                onDropOn={() => {
                  if (dragging !== null) void reorder(placeTopic(order, dragging, topic.id));
                  setDragging(null);
                }}
                onRename={() => setDialog({ kind: "rename", topic })}
                onChangeFolder={() => setDialog({ kind: "folder", topic })}
                onChangeIcon={() => setChoosingIcon(topic)}
                onRemove={() => setRemoving(topic)}
              />
            );
          })}
        </ul>
      ) : vault.suggestions.length === 0 ? (
        <p className="px-2 pb-1 text-xs text-sidebar-muted-foreground">
          Keep each ongoing subject here: one conversation, with its own folder of notes.
        </p>
      ) : null}
      {dialog !== null ? (
        <TopicDialog
          vault={vault}
          request={dialog}
          onClose={() => setDialog(null)}
          onCreated={(topic) => {
            if (dialog.kind === "create") {
              void open({ ...topic, threadEnvironmentId: vault.environmentId });
            }
          }}
        />
      ) : null}
      {removing !== null ? (
        <RemoveTopicDialog vault={vault} topic={removing} onClose={() => setRemoving(null)} />
      ) : null}
      {choosingIcon !== null ? (
        <TopicIconDialog vault={vault} topic={choosingIcon} onClose={() => setChoosingIcon(null)} />
      ) : null}
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
  readonly isDragging: boolean;
  readonly onOpen: () => void;
  readonly onNewChat: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDropOn: () => void;
  readonly onRename: () => void;
  readonly onChangeFolder: () => void;
  readonly onChangeIcon: () => void;
  readonly onRemove: () => void;
}) {
  const { topic, thread, vault } = props;
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const status = thread === undefined ? null : resolveThreadStatusPill({ thread });
  const activity = thread === undefined ? null : resolveThreadActivityTimestamp(thread);
  const { environments } = useEnvironments();
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
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-majordome-topic", topic.id);
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-majordome-topic")) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("application/x-majordome-topic")) return;
        event.preventDefault();
        event.stopPropagation();
        props.onDropOn();
      }}
      className={cn("group/topic relative", props.isDragging && "opacity-50")}
    >
      <button
        type="button"
        onClick={props.onOpen}
        aria-current={props.isActive ? "page" : undefined}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-lg py-1.5 pl-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-row-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          hasNested ? "pr-15" : "pr-9",
          props.isActive && topicRowTint(topic),
        )}
      >
        <TopicIconBadge topic={topic} statusDotClass={status?.dotClass ?? null} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{topic.title}</span>
            {status !== null ? <span className="sr-only">{status.label}</span> : null}
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
            <MenuItem onClick={props.onNewChat}>
              <MessageCirclePlusIcon />
              New chat about this
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={props.onRename}>
              <PencilIcon />
              Rename
            </MenuItem>
            <MenuItem onClick={props.onChangeFolder}>
              <FolderInputIcon />
              Change folder
            </MenuItem>
            <MenuItem onClick={props.onChangeIcon}>
              <ShapesIcon />
              Change icon
            </MenuItem>
            <MenuItem
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate(
                  notesLink({
                    projectId: vault.projectId,
                    environmentId: vault.environmentId,
                    path: topic.keyNote ?? undefined,
                  }),
                );
              }}
            >
              <NotebookTextIcon />
              Open folder in Notes
            </MenuItem>
            {props.onMove === null ? null : (
              <>
                <MenuSeparator />
                <MenuItem disabled={!props.onMove.up} onClick={() => props.onMove?.by(-1)}>
                  <ArrowUpIcon />
                  Move up
                </MenuItem>
                <MenuItem disabled={!props.onMove.down} onClick={() => props.onMove?.by(1)}>
                  <ArrowDownIcon />
                  Move down
                </MenuItem>
              </>
            )}
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={props.onRemove}>
              <TrashIcon />
              Remove topic
            </MenuItem>
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
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-row-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <MessageCircleIcon
                  className="size-3.5 shrink-0 text-sidebar-muted-foreground"
                  aria-hidden
                />
                <span className="truncate">
                  {chat.title === "New thread" ? "New chat" : chat.title}
                </span>
              </Link>
            </li>
          ))}
          {doneCount > 0 ? (
            <li>
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone((shown) => !shown)}
                className="w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {showDone
                  ? "Hide chats marked as done"
                  : `Show ${doneCount} earlier ${doneCount === 1 ? "chat" : "chats"}`}
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
                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <MessageCircleIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate text-sidebar-foreground">
                  Chat on{" "}
                  {environments
                    .find((environment) => environment.environmentId === chat.environmentId)
                    ?.label?.trim() || "another computer"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
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

function RemoveTopicDialog({
  vault,
  topic,
  onClose,
}: {
  readonly vault: MajordomeVault;
  readonly topic: MajordomeTopic;
  readonly onClose: () => void;
}) {
  const removeTopic = useAtomCommand(majordomeEnvironment.removeTopic, {
    label: "remove a topic",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const result = await removeTopic({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, topicId: topic.id },
    });
    setBusy(false);
    if (result._tag === "Failure") reportFailure(`Could not remove ${topic.title}`, result);
    onClose();
  };
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {topic.title} from your topics?</AlertDialogTitle>
          <AlertDialogDescription>
            Its notes stay in {topic.folder}. Its chats move to Recent, and a routine that posts in
            this topic keeps posting in the same chat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
            Cancel
          </AlertDialogClose>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            Remove topic
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
