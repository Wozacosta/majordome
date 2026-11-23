import { useAtomValue } from "@effect/atom-react";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  MajordomeTodo,
  MajordomeTodoNote,
  ProjectId,
  ProjectListEntriesResult,
  ThreadId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  BellIcon,
  MessageCircleIcon,
  MessageCirclePlusIcon,
  NotebookTextIcon,
  RepeatIcon,
} from "lucide-react";
import { useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { SETTLE_WORDS } from "../../settleWording";
import { useProject, useQuietThreadShells } from "../../state/entities";
import { majordomeEnvironment } from "../../state/majordome";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "../chat/threadDetailsPanelStyles";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { toastManager } from "../ui/toast";
import { onMachine } from "./brains.logic";
import { notesLink } from "./notes.logic";
import { todoDisplayText, todoKey } from "./todos.logic";
import { TopicFiles } from "./TopicFilesCard";
import { topicOfThread } from "./topicFiles.logic";
import {
  allNotesLabel,
  topicPanelChats,
  topicPanelNotes,
  topicPanelRoutines,
  topicPanelTodos,
} from "./TopicPanel.logic";
import type { MajordomeVault, VaultTopic } from "./topics.logic";
import { useMachineNames } from "./useMachineNames";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useOpenTopic } from "./useOpenTopic";
import { useVaultRoutines } from "./useVaultRoutines";

interface TopicPlace {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly topic: VaultTopic;
}

const MUTED_LINE_CLASS = "px-2.5 text-xs text-muted-foreground";
const QUIET_LINK_CLASS =
  "rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/**
 * A topic's own things beside its continuing chat: its notes, what is left to do in them, what
 * posts here on a schedule, its files and its other chats. Nothing for any other chat.
 */
export function TopicPanelSections({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { copies, vaults } = useMajordomeVaults();
  const found = topicOfThread(copies, environmentId, threadId);
  if (found === null) return null;
  const vault = vaults.find((candidate) =>
    candidate.copies.some(
      (copy) => copy.environmentId === environmentId && copy.projectId === found.projectId,
    ),
  );
  return (
    <TopicPanel
      key={`${found.projectId}:${found.topic.id}`}
      environmentId={environmentId}
      projectId={found.projectId}
      topic={found.topic}
      threadId={threadId}
      vault={vault}
    />
  );
}

function TopicPanel(
  props: TopicPlace & {
    readonly threadId: ThreadId;
    /** The notes folder across every computer that has it, when known. */
    readonly vault: MajordomeVault | undefined;
  },
) {
  const { environmentId, projectId, topic } = props;
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const workspaceRoot = project?.workspaceRoot ?? null;
  const place = { environmentId, projectId, topic };
  return (
    <>
      <TopicNotes {...place} workspaceRoot={workspaceRoot} />
      <TopicTodos {...place} />
      <TopicRoutines {...place} threadId={props.threadId} vault={props.vault} />
      <TopicFiles {...place} workspaceRoot={workspaceRoot} />
      <TopicChats {...place} threadId={props.threadId} vault={props.vault} />
    </>
  );
}

const NO_ENTRIES = Atom.make(AsyncResult.initial<ProjectListEntriesResult, never>(false)).pipe(
  Atom.withLabel("majordome:topic-panel-notes:none"),
);

function TopicNotes({
  environmentId,
  projectId,
  topic,
  workspaceRoot,
}: TopicPlace & { readonly workspaceRoot: string | null }) {
  const result = useAtomValue(
    workspaceRoot === null
      ? NO_ENTRIES
      : projectEnvironment.listEntries({
          environmentId,
          input: { cwd: workspaceRoot, directoryPath: topic.folder },
        }),
  );
  const notes = topicPanelNotes(topic, AsyncResult.getOrElse(result, () => null)?.entries ?? []);
  const linkTo = (path: string | undefined) => notesLink({ projectId, environmentId, path });
  return (
    <ThreadDetailsSection
      headingId="thread-details-topic-notes-heading"
      title="Notes"
      data-topic-panel-section
      actions={
        <Button
          size="xs"
          variant="ghost-muted"
          render={<Link {...linkTo(topic.keyNote ?? notes[0]?.path)} />}
        >
          {allNotesLabel(topic.notesCount)}
        </Button>
      }
    >
      <div className="flex flex-col">
        {notes.map((note) => (
          <ThreadDetailsControl
            key={note.path}
            size="xs"
            variant="ghost"
            part="row"
            panel
            title={note.path}
            render={<Link {...linkTo(note.path)} />}
          >
            <NotebookTextIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{note.label}</span>
          </ThreadDetailsControl>
        ))}
        {notes.length === 0 && result._tag !== "Initial" ? (
          <p className={MUTED_LINE_CLASS}>No notes yet. The assistant keeps them as you talk.</p>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

/** True when the command failed for a reason worth telling; the toast is already shown. */
function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string): boolean {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
  return true;
}

function TopicTodos({ environmentId, projectId, topic }: TopicPlace) {
  const result = useAtomValue(
    majordomeEnvironment.todos({ environmentId, input: { projectId, folder: topic.folder } }),
  );
  const canChange = useAtomValue(majordomeEnvironment.setTodoDone.permissionAtom(environmentId));
  const setTodoDone = useAtomCommand(majordomeEnvironment.setTodoDone, {
    label: "tick to-do",
    reportFailure: false,
  });
  // Ticked here; kept after the note is saved so a list read just before it never shows them again.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const tick = async (note: MajordomeTodoNote, todo: MajordomeTodo) => {
    const key = todoKey(note.path, todo);
    const input = { projectId, path: note.path, line: todo.line, text: todo.text };
    const show = () =>
      setTicked((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    setTicked((current) => new Set(current).add(key));
    const outcome = await setTodoDone({ environmentId, input: { ...input, done: true } });
    if (reportFailure(outcome, "Could not tick that to-do")) {
      show();
      return;
    }
    if (outcome._tag !== "Success") return;
    const toastId = toastManager.add({
      type: "success",
      title: "Ticked",
      description: todoDisplayText(todo.text),
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toastId);
          void setTodoDone({ environmentId, input: { ...input, done: false } }).then((undone) => {
            if (!reportFailure(undone, "Could not untick that to-do")) show();
          });
        },
      },
    });
  };

  const data = AsyncResult.getOrElse(result, () => null);
  if (data === null) return null;
  const { rows, more } = topicPanelTodos(data, topic.folder, ticked);
  if (rows.length === 0 && more === 0) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-topic-todos-heading"
      title="To-dos"
      data-topic-panel-section
    >
      <div className="flex flex-col">
        <ul className="m-0 flex list-none flex-col p-0" aria-label={`To-dos in ${topic.title}`}>
          {rows.map(({ note, todo }) => (
            <li key={todoKey(note.path, todo)}>
              <label className="flex min-h-8 cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-black/[0.035] dark:hover:bg-white/[0.08]">
                <span className="flex h-5 shrink-0 items-center">
                  <Checkbox
                    checked={false}
                    disabled={!canChange}
                    onCheckedChange={() => void tick(note, todo)}
                  />
                </span>
                <span className="min-w-0 flex-1 text-xs wrap-break-word text-foreground/80">
                  {todoDisplayText(todo.text)}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {more > 0 ? (
          <Link to="/todos" className={cn(QUIET_LINK_CLASS, "mx-2.5 mt-1 self-start")}>
            {rows.length === 0 ? `${more} in To-dos` : `${more} more`}
          </Link>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}

function TopicRoutines({
  environmentId,
  projectId,
  topic,
  threadId,
  vault,
}: TopicPlace & { readonly threadId: ThreadId; readonly vault: MajordomeVault | undefined }) {
  const scheduled = useVaultRoutines(
    vault ?? { copies: [{ environmentId, projectId, routinesThreadId: null }] },
  );
  const rows = topicPanelRoutines(scheduled, { environmentId, threadId });
  if (rows.length === 0) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-topic-routines-heading"
      title="Routines and reminders"
      data-topic-panel-section
    >
      <ul
        className="m-0 flex list-none flex-col p-0"
        aria-label={`Routines and reminders in ${topic.title}`}
      >
        {rows.map((row) => {
          const Icon = row.to === "/reminders" ? BellIcon : RepeatIcon;
          return (
            <li key={row.key} className={cn("flex min-w-0", row.off && "opacity-60")}>
              <ThreadDetailsControl
                size="xs"
                variant="ghost"
                part="row"
                panel
                multiline
                title={row.title}
                render={<Link to={row.to} />}
              >
                <Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate">{row.title}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {[row.when, row.off ? "Off" : ""].filter((part) => part !== "").join(" · ")}
                  </span>
                </span>
              </ThreadDetailsControl>
            </li>
          );
        })}
      </ul>
    </ThreadDetailsSection>
  );
}

function TopicChats({
  environmentId,
  projectId,
  topic,
  threadId,
  vault,
}: TopicPlace & { readonly threadId: ThreadId; readonly vault: MajordomeVault | undefined }) {
  const shells = useQuietThreadShells();
  const { machineOf } = useMachineNames();
  const canStart = useAtomValue(majordomeEnvironment.openTopic.permissionAtom(environmentId));
  const openTopic = useOpenTopic({ environmentId, projectId });
  const { unsettleThread } = useThreadActions();
  const [showDone, setShowDone] = useState(false);
  const [starting, setStarting] = useState(false);
  const shellByKey = new Map(
    shells.map((shell) => [scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)), shell]),
  );
  const chats = topicPanelChats({
    own: topic,
    merged: vault?.topics.find((candidate) => candidate.id === topic.id),
    current: { environmentId, threadId },
    shellOf: (chat) => shellByKey.get(scopedThreadKey(chat)),
  });
  if (!canStart && chats.open.length + chats.done.length + chats.elsewhere.length === 0) {
    return null;
  }
  const bringBack = async (chat: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }) => {
    const result = await unsettleThread(scopeThreadRef(chat.environmentId, chat.threadId));
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: SETTLE_WORDS.unsettleFailed,
      description: error instanceof Error ? error.message : String(error),
    });
  };
  const chatRow = (
    chat: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId },
    title: string,
    Row: "li" | "div" = "li",
  ) => (
    <Row key={scopedThreadKey(chat)} className="flex min-w-0 flex-1">
      <ThreadDetailsControl
        size="xs"
        variant="ghost"
        part="row"
        panel
        title={title}
        render={
          <Link
            to="/$environmentId/$threadId"
            params={buildThreadRouteParams(scopeThreadRef(chat.environmentId, chat.threadId))}
          />
        }
      >
        <MessageCircleIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </ThreadDetailsControl>
    </Row>
  );
  return (
    <ThreadDetailsSection
      headingId="thread-details-topic-chats-heading"
      title="Other chats"
      data-topic-panel-section
    >
      <div className="flex flex-col">
        <ul
          className="m-0 flex list-none flex-col p-0"
          aria-label={`Other chats in ${topic.title}`}
        >
          {chats.open.map((chat) => chatRow(chat, chat.title))}
          {chats.elsewhere.map((chat) =>
            chatRow(chat, `Chat ${onMachine(machineOf(chat.environmentId))}`),
          )}
        </ul>
        {canStart ? (
          <ThreadDetailsControl
            size="xs"
            variant="ghost"
            part="row"
            panel
            tone="muted"
            disabled={starting}
            onClick={() => {
              setStarting(true);
              void openTopic(topic, { sideChat: true }).finally(() => setStarting(false));
            }}
          >
            <MessageCirclePlusIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
            <span className="min-w-0 flex-1 truncate">New chat about this</span>
          </ThreadDetailsControl>
        ) : null}
        {chats.done.length > 0 ? (
          <ThreadDetailsControl
            size="xs"
            variant="ghost"
            part="row"
            panel
            tone="muted"
            aria-expanded={showDone}
            onClick={() => setShowDone((shown) => !shown)}
          >
            {showDone ? "Hide done chats" : `Done (${chats.done.length})`}
          </ThreadDetailsControl>
        ) : null}
        {showDone ? (
          <ul
            className="m-0 flex list-none flex-col p-0"
            aria-label={`Done chats in ${topic.title}`}
          >
            {chats.done.map((chat) => (
              <li key={scopedThreadKey(chat)} className="flex min-w-0 items-center">
                <div className="flex min-w-0 flex-1">{chatRow(chat, chat.title, "div")}</div>
                <span className="mr-1.5 flex shrink-0">
                  <Button size="xs" variant="ghost-muted" onClick={() => void bringBack(chat)}>
                    {SETTLE_WORDS.unsettleThread}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}
