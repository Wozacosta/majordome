/** A chat's title as Majordome shows it: one not named yet is stored as "New thread". */
export function chatTitle(title: string): string {
  return title === "New thread" ? "New chat" : title;
}

// Keyed by the status words upstream's `resolveThreadStatusPill` gives.
const STATUS_WORDS: Readonly<Record<string, string>> = {
  "Pending Approval": "Needs your OK",
  "Awaiting Input": "Waiting for your answer",
  "Guest Request": "A guest wrote",
  Connecting: "Starting…",
  Failed: "Stopped on an error",
  "Plan Ready": "Has a plan for you",
  Completed: "New reply",
};

/** What a chat is doing, in plain words. */
export function chatStatusWords(label: string): string {
  return STATUS_WORDS[label] ?? label;
}

/** The title to save after a rename, or null when what was typed is empty or changes nothing. */
export function renamedChatTitle(typed: string, stored: string): string | null {
  const title = typed.trim();
  return title === "" || title === stored || title === chatTitle(stored) ? null : title;
}

/** One chat as the Chats page lists it. */
export interface ChatRow<T> {
  readonly thread: T;
  /** When something last happened in it, for ordering and for "3h ago". */
  readonly at: string | null;
}

/**
 * The chats that belong to no topic, split the way the page shows them: the ones still going,
 * newest first, then the ones that are done. `query` keeps only the titles, as shown, that contain it.
 */
export function splitChats<T extends { readonly title: string }>(
  threads: ReadonlyArray<T>,
  input: {
    readonly query: string;
    readonly isDone: (thread: T) => boolean;
    readonly activityOf: (thread: T) => string | null;
  },
): { readonly current: ReadonlyArray<ChatRow<T>>; readonly done: ReadonlyArray<ChatRow<T>> } {
  const wanted = input.query.trim().toLowerCase();
  const rows = threads
    .filter((thread) => wanted === "" || chatTitle(thread.title).toLowerCase().includes(wanted))
    .map((thread) => ({ thread, at: input.activityOf(thread) }))
    .toSorted((left, right) => (right.at ?? "").localeCompare(left.at ?? ""));
  return {
    current: rows.filter((row) => !input.isDone(row.thread)),
    done: rows.filter((row) => input.isDone(row.thread)),
  };
}
