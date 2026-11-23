import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

/** A line typed on the phone for a day's note, kept until the server has it. */
export interface NoteCapture {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** The phone's own day and time when it was typed. */
  readonly date: string;
  readonly time: string;
  readonly text: string;
}

/** What Today keeps on the phone so it opens with no connection. */
export interface TodayStore {
  readonly vault: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  } | null;
  readonly note: { readonly date: string; readonly content: string | null } | null;
  readonly captures: ReadonlyArray<NoteCapture>;
}

export const EMPTY_TODAY_STORE: TodayStore = { vault: null, note: null, captures: [] };

const two = (value: number) => String(value).padStart(2, "0");

export const localDate = (now: Date) =>
  `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;

export const localTime = (now: Date) => `${two(now.getHours())}:${two(now.getMinutes())}`;

/** `index` is the line's place in the note, which also tells two equal lines apart. */
export type NoteLine = { readonly text: string; readonly index: number } & (
  | { readonly kind: "heading" | "text" }
  | { readonly kind: "todo"; readonly done: boolean }
);

const TODO = /^(\s*(?:[-*+]|\d+[.)]) \[)([ xX])(\] )(.*)$/;

/** Markdown's marks taken off a line: emphasis, code ticks, and a link down to its text. */
export const plain = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/(\*\*|__|`|~~)/g, "");

/** A day's note as Today lists it: headings, to-dos that can be ticked, and everything else. */
export function noteLines(content: string): ReadonlyArray<NoteLine> {
  const lines: Array<NoteLine> = [];
  let frontmatter = content.startsWith("---\n");
  content.split("\n").forEach((line, index) => {
    if (frontmatter) {
      if (index > 0 && line.trim() === "---") frontmatter = false;
      return;
    }
    const todo = TODO.exec(line);
    if (todo) {
      lines.push({ kind: "todo", text: plain(todo[4] ?? ""), done: todo[2] !== " ", index });
      return;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      lines.push({ kind: "heading", text: plain(heading[1] ?? ""), index });
      return;
    }
    if (line.trim().length > 0) {
      lines.push({ kind: "text", text: plain(line.replace(/^\s*[-*+] /, "• ")), index });
    }
  });
  return lines;
}

/** The note with the to-do on line `index` ticked or unticked; unchanged when that line is not one. */
export function toggleTodo(content: string, index: number): string {
  const lines = content.split("\n");
  const todo = TODO.exec(lines[index] ?? "");
  if (!todo) return content;
  lines[index] = `${todo[1]}${todo[2] === " " ? "x" : " "}${todo[3]}${todo[4]}`;
  return lines.join("\n");
}

/** The note as it will read once the waiting lines for that day reach it. */
export function waitingFor(
  captures: ReadonlyArray<NoteCapture>,
  vault: TodayStore["vault"],
  date: string,
): ReadonlyArray<NoteCapture> {
  return vault === null
    ? []
    : captures.filter(
        (capture) =>
          capture.environmentId === vault.environmentId &&
          capture.projectId === vault.projectId &&
          capture.date === date,
      );
}
