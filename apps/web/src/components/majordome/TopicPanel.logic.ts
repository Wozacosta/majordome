import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  MajordomeTodo,
  MajordomeTodoNote,
  MajordomeTodosResult,
  ServerProviderUsageWindow,
  ThreadId,
} from "@t3tools/contracts";
import { remainingPercent } from "@t3tools/shared/usageLimits";

import { isMarkdownPreviewFile } from "../files/filePreviewMode";
import { isHiddenVaultPath } from "./notes.logic";
import { plainDateTime, type RoutineItem, routineScheduleWords } from "./routines.logic";
import { todoKey } from "./todos.logic";
import type { VaultTopic } from "./topics.logic";

/** The share left at which a limit window turns to its warning colour, then to its error colour. */
const USAGE_WARNING_PERCENT_LEFT = 20;
const USAGE_ERROR_PERCENT_LEFT = 10;

export function usageTone(percentLeft: number): "error" | "warning" | null {
  return percentLeft <= USAGE_ERROR_PERCENT_LEFT
    ? "error"
    : percentLeft <= USAGE_WARNING_PERCENT_LEFT
      ? "warning"
      : null;
}

interface ReaderOptions {
  readonly locale?: string | undefined;
  /** The reader's zone; the browser's when left out. */
  readonly timeZone?: string | undefined;
}

const PLAN_PERIOD: Record<ServerProviderUsageWindow["kind"], string> = {
  session: " for now",
  weekly: " this week",
  monthly: " this month",
  other: "",
};

/** Whole days from `fromMs` to `toMs` on the reader's calendar. */
function calendarDaysBetween(fromMs: number, toMs: number, timeZone: string | undefined): number {
  const day = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      ...(timeZone === undefined ? {} : { timeZone }),
    }).formatToParts(new Date(ms));
    const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"));
  };
  return Math.round((day(toMs) - day(fromMs)) / 86_400_000);
}

/** "It resets Thursday.", "It resets today at 15:00.", or nothing when no reset is ahead. */
function resetWords(resetsAt: string | undefined, nowMs: number, options: ReaderOptions): string {
  const at = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt);
  if (!(at > nowMs)) return "";
  const zone = options.timeZone === undefined ? {} : { timeZone: options.timeZone };
  const format = (parts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(options.locale, { ...parts, ...zone }).format(new Date(at));
  const days = calendarDaysBetween(nowMs, at, options.timeZone);
  if (days === 0) return ` It resets today at ${format({ hour: "numeric", minute: "2-digit" })}.`;
  if (days === 1) return " It resets tomorrow.";
  if (days < 7) return ` It resets ${format({ weekday: "long" })}.`;
  return ` It resets on ${format({ day: "numeric", month: "long" })}.`;
}

/**
 * The one line the chat's panel shows about the AI plan, only once a limit window is low: the
 * lowest window, in plain words, with when it resets. Null while there is room everywhere.
 */
export function lowUsageLine(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
  nowMs: number,
  options: ReaderOptions = {},
): { readonly tone: "error" | "warning"; readonly text: string } | null {
  let lowest: ServerProviderUsageWindow | null = null;
  for (const window of windows) {
    // A window whose reset has passed describes the period before it.
    if (window.resetsAt !== undefined && Date.parse(window.resetsAt) <= nowMs) continue;
    if (lowest === null || remainingPercent(window) < remainingPercent(lowest)) lowest = window;
  }
  if (lowest === null) return null;
  const left = remainingPercent(lowest);
  const tone = usageTone(left);
  if (tone === null) return null;
  const period = PLAN_PERIOD[lowest.kind];
  const text =
    left <= 0
      ? `You've used up your AI plan${period}.`
      : `You're running low on your AI plan${period}.`;
  return { tone, text: `${text}${resetWords(lowest.resetsAt, nowMs, options)}` };
}

interface TopicPanelNote {
  /** Relative to the vault. */
  readonly path: string;
  readonly label: string;
  /** The note the assistant keeps the topic's running log in, or its overview. */
  readonly isKeyNote: boolean;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/** A note's name as the owner reads it: "Running log" for `log.md`, else the file's own name. */
export function topicNoteLabel(path: string): string {
  const name = baseName(path);
  if (/^log$/i.test(name)) return "Running log";
  if (/^(?:readme|index)$/i.test(name)) return "Overview";
  return name.replace(/[-_]+/g, " ").trim() || name;
}

const TOPIC_PANEL_MORE_NOTES = 4;

/**
 * The notes the panel lists for a topic: its key note first, then a few more from its folder. A
 * folder listing carries no dates, so the rest come nearest the top of the folder first, by name.
 */
export function topicPanelNotes(
  topic: Pick<VaultTopic, "folder" | "keyNote">,
  entries: ReadonlyArray<{ readonly path: string; readonly kind: string }>,
  limit = TOPIC_PANEL_MORE_NOTES,
): ReadonlyArray<TopicPanelNote> {
  const prefix = `${topic.folder.replace(/\/+$/, "")}/`;
  const depth = (path: string) => path.split("/").length;
  const others = new Set(
    entries
      .filter(
        (entry) =>
          entry.kind === "file" &&
          entry.path.startsWith(prefix) &&
          entry.path !== topic.keyNote &&
          isMarkdownPreviewFile(entry.path) &&
          !isHiddenVaultPath(entry.path),
      )
      .map((entry) => entry.path),
  );
  const paths = [
    ...(topic.keyNote === null ? [] : [topic.keyNote]),
    ...[...others]
      .toSorted(
        (left, right) =>
          depth(left) - depth(right) ||
          topicNoteLabel(left).localeCompare(topicNoteLabel(right)) ||
          left.localeCompare(right),
      )
      .slice(0, limit),
  ];
  return paths.map((path) => ({
    path,
    label: topicNoteLabel(path),
    isKeyNote: path === topic.keyNote,
  }));
}

/** "All notes (12)" once a server says how many the folder holds. */
export function allNotesLabel(notesCount: number | undefined): string {
  return notesCount === undefined ? "All notes" : `All notes (${notesCount})`;
}

const TOPIC_PANEL_TODOS = 5;

/**
 * The first open to-dos of a topic's notes, without those just ticked here, and how many more
 * there are. A server from before to-dos could be asked by folder answers for the whole notes
 * folder, so only notes under the topic's folder count.
 */
export function topicPanelTodos(
  result: Pick<MajordomeTodosResult, "notes" | "totalOpen">,
  folder: string,
  ticked: ReadonlySet<string>,
  limit = TOPIC_PANEL_TODOS,
): {
  readonly rows: ReadonlyArray<{ readonly note: MajordomeTodoNote; readonly todo: MajordomeTodo }>;
  readonly more: number;
} {
  const prefix = `${folder.replace(/\/+$/, "")}/`;
  const notes = result.notes.filter((note) => note.path.startsWith(prefix));
  const listed = notes.reduce((sum, note) => sum + note.todos.length + note.more, 0);
  // The total also counts notes the answer's cap left out, when the answer is this folder's own.
  const total = notes.length === result.notes.length ? Math.max(result.totalOpen, listed) : listed;
  const open = notes.flatMap((note) =>
    note.todos.flatMap((todo) => (ticked.has(todoKey(note.path, todo)) ? [] : [{ note, todo }])),
  );
  const hidden = notes.reduce((sum, note) => sum + note.todos.length, 0) - open.length;
  const rows = open.slice(0, limit);
  return { rows, more: Math.max(0, total - hidden - rows.length) };
}

interface TopicPanelRoutine {
  readonly key: string;
  readonly title: string;
  /** "Mondays at 9:00" for a routine, "Tue, Dec 1, 10:00" for a reminder. */
  readonly when: string;
  readonly off: boolean;
  readonly to: "/routines" | "/reminders";
}

/** What posts in this chat: the routines and upcoming reminders tied to it, on its own server. */
export function topicPanelRoutines(
  scheduled: {
    readonly routines: ReadonlyArray<RoutineItem>;
    readonly reminders: ReadonlyArray<RoutineItem>;
  },
  chat: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId },
  options: ReaderOptions = {},
): ReadonlyArray<TopicPanelRoutine> {
  const here = (item: RoutineItem) =>
    item.environmentId === chat.environmentId && item.task.threadId === chat.threadId;
  return [
    ...scheduled.routines.filter(here).map((item): TopicPanelRoutine => ({
      key: item.key,
      title: item.task.title,
      when: routineScheduleWords(item.task.schedule, {
        serverTimeZone: item.timeZone,
        readerTimeZone: options.timeZone,
        locale: options.locale,
      }),
      off: !item.task.enabled,
      to: "/routines",
    })),
    ...scheduled.reminders.filter(here).map((item): TopicPanelRoutine => {
      const at =
        item.task.nextRunAt ?? (item.task.schedule.type === "once" ? item.task.schedule.runAt : "");
      return {
        key: item.key,
        title: item.task.title,
        when: at === "" ? "" : plainDateTime(at, options.locale, options.timeZone),
        off: !item.task.enabled,
        to: "/reminders",
      };
    }),
  ];
}

type ChatRef = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

interface TopicPanelChat extends ChatRef {
  readonly title: string;
}

/**
 * The topic's other chats, seen from one of its chats: the side chats still open, those marked
 * as done, and the topic's chats on other computers. `merged` is the topic across every computer,
 * when known; `own` is this computer's copy.
 */
export function topicPanelChats(input: {
  readonly own: VaultTopic;
  readonly merged: VaultTopic | undefined;
  readonly current: ChatRef;
  readonly shellOf: (
    chat: ChatRef,
  ) => { readonly title: string; readonly settledOverride: string | null } | undefined;
}): {
  readonly open: ReadonlyArray<TopicPanelChat>;
  readonly done: ReadonlyArray<TopicPanelChat>;
  /** The topic's continuing chat on each other computer. */
  readonly elsewhere: ReadonlyArray<ChatRef>;
} {
  const topic = input.merged ?? input.own;
  const currentKey = scopedThreadKey(input.current);
  const seen = new Set([currentKey]);
  const fresh = (chat: ChatRef) => {
    const key = scopedThreadKey(chat);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const open: Array<TopicPanelChat> = [];
  const done: Array<TopicPanelChat> = [];
  for (const chat of topic.sideChats ?? []) {
    const shell = input.shellOf(chat);
    if (shell === undefined || !fresh(chat)) continue;
    const row = {
      environmentId: chat.environmentId,
      threadId: chat.threadId,
      title: shell.title === "New thread" ? "New chat" : shell.title,
    };
    (shell.settledOverride === "settled" ? done : open).push(row);
  }
  const mains: ReadonlyArray<ChatRef> = [
    ...(topic.threadId === null
      ? []
      : [{ environmentId: topic.threadEnvironmentId, threadId: topic.threadId }]),
    ...(topic.otherChats ?? []),
  ];
  return { open, done, elsewhere: mains.filter(fresh) };
}

/**
 * A topic's chats as tabs, seen from one of them: its continuing chat first (null until it is
 * started where the topic's conversations are kept), then its other chats in their order. Chats
 * marked as done are left out, except the one being read.
 */
export function topicTabs(input: {
  readonly own: VaultTopic;
  readonly merged: VaultTopic | undefined;
  readonly current: ChatRef;
  readonly shellOf: (
    chat: ChatRef,
  ) => { readonly title: string; readonly settledOverride: string | null } | undefined;
}): {
  readonly main: ChatRef | null;
  readonly chats: ReadonlyArray<TopicPanelChat & { readonly done: boolean }>;
  /** The topic's continuing chat on each computer that is not its home. */
  readonly elsewhere: ReadonlyArray<ChatRef>;
} {
  const topic = input.merged ?? input.own;
  const currentKey = scopedThreadKey(input.current);
  const main =
    topic.threadId === null
      ? null
      : { environmentId: topic.threadEnvironmentId, threadId: topic.threadId };
  const mainKey = main === null ? null : scopedThreadKey(main);
  const listedElsewhere = topic.otherChats ?? [];
  // A computer's own continuing chat keeps a tab while it is read, even one too empty to list.
  const elsewhere =
    input.own.threadId !== input.current.threadId ||
    currentKey === mainKey ||
    listedElsewhere.some((chat) => scopedThreadKey(chat) === currentKey)
      ? listedElsewhere
      : [...listedElsewhere, input.current];
  const seen = new Set<string>();
  const chats = (topic.sideChats ?? []).flatMap((chat) => {
    const key = scopedThreadKey(chat);
    const shell = input.shellOf(chat);
    if (shell === undefined || seen.has(key)) return [];
    seen.add(key);
    const done = shell.settledOverride === "settled";
    if (done && key !== currentKey) return [];
    return [
      {
        environmentId: chat.environmentId,
        threadId: chat.threadId,
        title: shell.title === "New thread" ? "New chat" : shell.title,
        done,
      },
    ];
  });
  return { main, chats, elsewhere };
}

/**
 * The entry one step from `current` in a list that wraps around, or its first or last entry when
 * `current` is not in it. Null when that leads nowhere new.
 */
export function stepAround<T>(
  items: ReadonlyArray<T>,
  current: T | null,
  direction: 1 | -1,
): T | null {
  const index = current === null ? -1 : items.indexOf(current);
  if (index === -1) return (direction === 1 ? items[0] : items.at(-1)) ?? null;
  if (items.length < 2) return null;
  return items[(index + direction + items.length) % items.length] ?? null;
}
