/** One chat as the Chats page lists it. */
export interface ChatRow<T> {
  readonly thread: T;
  /** When something last happened in it, for ordering and for "3h ago". */
  readonly at: string | null;
}

/**
 * The chats that belong to no topic, split the way the page shows them: the ones still going,
 * newest first, then the ones marked as done. `query` keeps only titles that contain it.
 */
export function splitChats<T extends { readonly title: string }>(
  threads: ReadonlyArray<T>,
  input: {
    readonly query: string;
    readonly isDone: (thread: T) => boolean;
    readonly activityOf: (thread: T) => string | null;
  },
): { readonly current: ReadonlyArray<ChatRow<T>>; readonly earlier: ReadonlyArray<ChatRow<T>> } {
  const wanted = input.query.trim().toLowerCase();
  const rows = threads
    .filter((thread) => wanted === "" || thread.title.toLowerCase().includes(wanted))
    .map((thread) => ({ thread, at: input.activityOf(thread) }))
    .toSorted((left, right) => (right.at ?? "").localeCompare(left.at ?? ""));
  return {
    current: rows.filter((row) => !input.isDone(row.thread)),
    earlier: rows.filter((row) => input.isDone(row.thread)),
  };
}
