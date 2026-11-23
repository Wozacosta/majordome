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

/** What VoiceOver reads for a row: its title, its line, when it last moved, and whether it is unread. */
export function chatRowLabel(input: {
  readonly title: string;
  readonly line: ChatLine | null;
  readonly time: string | null;
}): string {
  const unread = input.line?.tone === "new" && input.line.words !== "New reply";
  return [input.title, unread ? "New reply" : null, input.line?.words, input.time]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(", ");
}

// A chat's long-press menu offers these upstream; they are about code and mean nothing here.
const CODING_MENU_ACTIONS = new Set([
  "new-thread-on-branch",
  "copy-thread-id",
  "turn-into-project",
]);

/** A chat's long-press menu without the entries about code, at any depth. */
export function chatMenuActions<
  T extends { readonly id?: string; readonly subactions?: ReadonlyArray<T> },
>(actions: ReadonlyArray<T>): Array<T> {
  return actions
    .filter((action) => action.id === undefined || !CODING_MENU_ACTIONS.has(action.id))
    .map((action) =>
      action.subactions ? { ...action, subactions: chatMenuActions(action.subactions) } : action,
    );
}
