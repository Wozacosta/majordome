import type { MajordomeTodo, MajordomeTodoNote, MajordomeTodosResult } from "@t3tools/contracts";

/** Names one listed to-do: its note, its line and its words. */
export const todoKey = (notePath: string, todo: MajordomeTodo) =>
  `${notePath}\n${todo.line}\n${todo.text}`;

/**
 * The list without the to-dos just ticked here, which the notes may not show as done yet. A note
 * with nothing left to show is dropped, and the totals count what is left.
 */
export function withoutTicked(
  result: Pick<MajordomeTodosResult, "notes" | "totalOpen" | "totalNotes">,
  ticked: ReadonlySet<string>,
): {
  readonly notes: ReadonlyArray<MajordomeTodoNote>;
  readonly totalOpen: number;
  readonly totalNotes: number;
} {
  let hidden = 0;
  let emptied = 0;
  const notes: Array<MajordomeTodoNote> = [];
  for (const note of result.notes) {
    const todos = note.todos.filter((todo) => !ticked.has(todoKey(note.path, todo)));
    hidden += note.todos.length - todos.length;
    if (todos.length === 0 && note.more === 0) emptied += 1;
    else notes.push(todos.length === note.todos.length ? note : { ...note, todos });
  }
  return {
    notes,
    totalOpen: Math.max(0, result.totalOpen - hidden),
    totalNotes: Math.max(0, result.totalNotes - emptied),
  };
}

/** "12 to do in 4 notes". */
export function todosSummary(totalOpen: number, totalNotes: number): string {
  return `${totalOpen} to do in ${totalNotes} ${totalNotes === 1 ? "note" : "notes"}`;
}
