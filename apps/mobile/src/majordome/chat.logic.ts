import type { ThreadListV2Status } from "../features/threads/threadListV2";

/** A chat's title as Majordome shows it: one not named yet is stored as "New thread". */
export function chatTitle(title: string): string {
  return title === "New thread" ? "New chat" : title;
}

/** True when what was typed in "Rename" only repeats the title as it is shown. */
export function keepsChatTitle(typed: string, stored: string): boolean {
  return typed.trim() === chatTitle(stored);
}

/** How a row's second line reads: plain, or coloured for what it asks of the owner. */
export type ChatLineTone = "plain" | "working" | "asking" | "problem" | "new";

export interface ChatLine {
  readonly words: string;
  readonly tone: ChatLineTone;
}

const STATUS_LINES: Readonly<Record<Exclude<ThreadListV2Status, "ready">, ChatLine>> = {
  approval: { words: "Needs your OK", tone: "asking" },
  input: { words: "Waiting for your answer", tone: "asking" },
  request: { words: "A guest wrote", tone: "asking" },
  working: { words: "Working…", tone: "working" },
  waiting: { words: "Working…", tone: "working" },
  failed: { words: "Stopped on an error", tone: "problem" },
  limited: { words: "Paused: usage limit reached", tone: "problem" },
};

/** What a chat is doing, in plain words; null when it is at rest and already read. */
export function chatStatusLine(status: ThreadListV2Status, unread: boolean): ChatLine | null {
  if (status !== "ready") return STATUS_LINES[status];
  return unread ? { words: "New reply", tone: "new" } : null;
}

/** A row draws its dot when the chat has something for the owner: an unread reply or a question. */
export function chatWantsAttention(line: ChatLine | null): boolean {
  return line !== null && (line.tone === "new" || line.tone === "asking");
}

/**
 * A topic's second line: what its conversation is doing when that needs saying, else the latest
 * message, else where the topic stands.
 */
export function topicLine(
  topic: { readonly preview: string | null; readonly notes?: number | undefined },
  status: ChatLine | null,
): ChatLine {
  if (status !== null && status.tone !== "new") return status;
  if (topic.preview !== null) return { words: topic.preview, tone: status?.tone ?? "plain" };
  if (status !== null) return status;
  const notes = topic.notes ?? 0;
  return {
    words:
      notes === 0
        ? "No messages yet"
        : `${notes} ${notes === 1 ? "note" : "notes"} · no messages yet`,
    tone: "plain",
  };
}

/**
 * What a chat at rest shows where its latest message would be. The server's list of chats carries
 * no message text, so this says only who spoke last, and on which computer when there are several.
 */
export function chatRestLine(
  chat: {
    readonly latestUserMessageAt: string | null;
    readonly latestRun: { readonly completedAt: string | null } | null;
  },
  computer: string | null = null,
): ChatLine | null {
  const repliedAt = Date.parse(chat.latestRun?.completedAt ?? "");
  const wroteAt = Date.parse(chat.latestUserMessageAt ?? "");
  const state =
    chat.latestUserMessageAt === null && chat.latestRun === null
      ? "No messages yet"
      : !Number.isNaN(repliedAt) && (Number.isNaN(wroteAt) || repliedAt >= wroteAt)
        ? "Replied"
        : null;
  const words = [state, computer].filter((part) => part !== null).join(" · ");
  return words === "" ? null : { words, tone: "plain" };
}

/** What VoiceOver reads for a row: its title, what it is, its line, and when it last moved. */
export function chatRowLabel(input: {
  readonly title: string;
  readonly line: ChatLine | null;
  readonly time: string | null;
  readonly topic?: boolean;
  readonly pinned?: boolean;
  readonly done?: boolean;
}): string {
  const unread = input.line?.tone === "new" && input.line.words !== "New reply";
  return [
    input.title,
    input.topic ? "topic" : null,
    unread ? "New reply" : null,
    input.line?.words,
    input.time,
    input.pinned ? "pinned" : null,
    input.done ? "done" : null,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(", ");
}

// What a chat's long-press menu keeps, in the order shown; upstream's other entries are about code
// or repeat these (archive beside done and delete).
const CHAT_MENU_ORDER = [
  "pin",
  "unpin",
  "rename",
  "mark-unread",
  "snooze",
  "unsnooze",
  "settle",
  "unsettle",
  "share-guest",
  "delete",
];

/** A chat's long-press menu as one short list: upstream's nested menus flattened and trimmed. */
export function chatMenuActions<
  T extends { readonly id?: string; readonly subactions?: ReadonlyArray<T> },
>(actions: ReadonlyArray<T>): Array<T> {
  const found = new Map<string, T>();
  const collect = (list: ReadonlyArray<T>) => {
    for (const action of list) {
      if (action.id !== undefined && CHAT_MENU_ORDER.includes(action.id)) {
        if (!found.has(action.id)) found.set(action.id, action);
      } else if (action.subactions) {
        collect(action.subactions);
      }
    }
  };
  collect(actions);
  return CHAT_MENU_ORDER.flatMap((id) => found.get(id) ?? []);
}

/** A topic's long-press menu: the chat entries that also fit a topic, around its own two. */
export function topicMenuActions<T extends { readonly id?: string }>(
  chatActions: ReadonlyArray<T>,
  title: string,
): Array<T | { readonly id: string; readonly title: string; readonly image: string }> {
  const kept = (ids: ReadonlyArray<string>) =>
    chatActions.filter((action) => action.id !== undefined && ids.includes(action.id));
  return [
    { id: "topic-side-chat", title: `New chat about ${title}`, image: "square.and.pencil" },
    ...kept(["pin", "unpin", "mark-unread"]),
    { id: "topic-finish", title: "Close this topic", image: "archivebox" },
  ];
}

/** A routine's long-press menu: a chat's, with the way to take the routine out of the list. */
export function routineMenuActions<T extends { readonly id?: string }>(
  chatActions: ReadonlyArray<T>,
): Array<T | { readonly id: string; readonly title: string; readonly image: string }> {
  return [
    ...chatActions,
    { id: "routine-hide", title: "Hide this routine from Chats", image: "eye.slash" },
  ];
}

/** True when a row's title or line contains what was typed in the search box. */
export function chatMatchesSearch(
  query: string,
  row: { readonly title: string; readonly preview?: string | null },
): boolean {
  const wanted = query.trim().toLocaleLowerCase();
  return (
    wanted === "" ||
    row.title.toLocaleLowerCase().includes(wanted) ||
    (row.preview ?? "").toLocaleLowerCase().includes(wanted)
  );
}

/**
 * The Chats list with its open chats ordered like a messaging app: whatever moved last comes
 * first. Pinned rows, the shelves and the rows inside them keep the places upstream gave them.
 */
export function orderChatsByActivity<
  T extends {
    readonly type: string;
    readonly item?: {
      readonly variant: string;
      readonly pinned: boolean;
      readonly snoozed: boolean;
    };
  },
>(items: ReadonlyArray<T>, activityOf: (item: T) => string | null): Array<T> {
  const open = (item: T) =>
    item.type === "v2-thread" &&
    item.item?.variant === "card" &&
    item.item.pinned === false &&
    item.item.snoozed === false;
  const at = (item: T) => {
    const parsed = Date.parse(activityOf(item) ?? "");
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const ordered = [...items];
  let start = 0;
  while (start < ordered.length) {
    if (!open(ordered[start]!)) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < ordered.length && open(ordered[end]!)) end += 1;
    const run = ordered.slice(start, end).sort((left, right) => at(right) - at(left));
    ordered.splice(start, run.length, ...run);
    start = end;
  }
  return ordered;
}

/** What the Chats tab says when there is nothing to list and a chat can be started. */
export const NO_CHATS_YET = {
  title: "No chats yet",
  detail: "Ask anything, or say what you want noted down.",
  action: "Start a chat",
} as const;

/** What a search of the Chats tab says when it finds no chat and no topic. */
export function nothingFound(query: string): { readonly title: string; readonly detail: string } {
  return {
    title: "Nothing found",
    detail: `No chat or topic matches "${query.trim()}". Try another word.`,
  };
}

/** True when the empty Chats tab can offer a new chat: a computer answers and has a notes folder. */
export function canStartFirstChat(input: {
  readonly loading: boolean;
  readonly hasReadyComputer: boolean;
  readonly folders: number;
}): boolean {
  return !input.loading && input.hasReadyComputer && input.folders > 0;
}
