/** One routine's row in the Chats list: its latest run, with the earlier ones folded under it. */
export interface RoutineFold {
  readonly id: string;
  readonly title: string;
  readonly sideThreadIds: ReadonlyArray<string>;
}

export const routineFoldId = (title: string) => `routine:${title}`;

/**
 * The chats that are a routine's, by thread id, each with the routine's name: the chat a routine
 * keeps, and the ones it opened on each run before it kept one, which carry its name and were not
 * started by the owner. One-time reminders are left as ordinary chats.
 */
export function routineChats(
  tasks: ReadonlyArray<{
    readonly title: string;
    readonly threadId: string | null;
    readonly schedule: { readonly type: string };
  }>,
  threads: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly createdBy: string;
  }>,
): ReadonlyMap<string, string> {
  const titles = new Set<string>();
  const found = new Map<string, string>();
  for (const task of tasks) {
    if (task.schedule.type === "once") continue;
    titles.add(task.title);
    if (task.threadId !== null) found.set(task.threadId, task.title);
  }
  for (const thread of threads) {
    if (thread.createdBy !== "user" && titles.has(thread.title) && !found.has(thread.id)) {
      found.set(thread.id, thread.title);
    }
  }
  return found;
}

/**
 * The Chats list with a routine's chats gathered: the hidden routines' chats are left out, and of
 * each other routine the first listed chat (its latest run) carries the rest as its fold.
 * `threadIdOf` answers null for a row that stays as it is.
 */
export function gatherRoutineChats<T>(
  items: ReadonlyArray<T>,
  threadIdOf: (item: T) => string | null,
  routineOf: ReadonlyMap<string, string>,
  hidden: ReadonlySet<string>,
): { readonly items: Array<T>; readonly byThread: ReadonlyMap<string, RoutineFold> } {
  const kept: Array<T> = [];
  const groups = new Map<string, Array<string>>();
  for (const item of items) {
    const id = threadIdOf(item);
    const title = id === null ? undefined : routineOf.get(id);
    if (id === null || title === undefined) {
      kept.push(item);
      continue;
    }
    if (hidden.has(title)) continue;
    kept.push(item);
    groups.set(title, [...(groups.get(title) ?? []), id]);
  }
  const byThread = new Map<string, RoutineFold>();
  for (const [title, [first, ...rest]] of groups) {
    if (first !== undefined) {
      byThread.set(first, { id: routineFoldId(title), title, sideThreadIds: rest });
    }
  }
  return { items: kept, byThread };
}
