import type { EnvironmentId, MajordomeTopicIcon, ProjectId } from "@t3tools/contracts";
import { topicIcon, topicTone, type TopicTone } from "@t3tools/shared/majordomeTopicIcons";

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
  /** The topics as the server last listed them. */
  readonly topics: ReadonlyArray<TopicRow>;
}

/** One topic as the phone lists it: a conversation with its latest message. */
export interface TopicRow {
  readonly id: string;
  readonly title: string;
  /** Null until the topic's conversation has been opened on that server. */
  readonly threadId: string | null;
  readonly preview: string | null;
  /** The same icon and colour the desktop shows; absent from a list an older build stored. */
  readonly icon?: MajordomeTopicIcon;
  readonly tone?: TopicTone;
  /** How many notes its folder holds, when the server says. */
  readonly notes?: number;
  /** The other chats about the topic, which the Chats list folds under it. */
  readonly sideThreadIds?: ReadonlyArray<string>;
}

export const EMPTY_TODAY_STORE: TodayStore = { vault: null, note: null, captures: [], topics: [] };

/** The topics still going, each with a line saying where its conversation is. */
export function topicRows(
  topics: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly folder: string;
    readonly icon?: MajordomeTopicIcon | undefined;
    readonly finishedAt?: string | undefined;
    readonly threadId: string | null;
    readonly lastMessagePreview?:
      | { readonly author: "you" | "agent"; readonly text: string }
      | null
      | undefined;
    readonly standing?: { readonly text: string } | null | undefined;
    readonly notesCount?: number | undefined;
    readonly sideThreadIds?: ReadonlyArray<string> | undefined;
  }>,
): ReadonlyArray<TopicRow> {
  return topics
    .filter((topic) => topic.finishedAt === undefined)
    .map((topic) => {
      const last = topic.lastMessagePreview;
      const preview = last
        ? `${last.author === "you" ? "You: " : ""}${last.text}`
        : (topic.standing?.text.split("\n")[0] ?? null);
      return {
        id: topic.id,
        title: topic.title,
        threadId: topic.threadId,
        preview,
        icon: topicIcon(topic),
        tone: topicTone(topic),
        ...(topic.notesCount === undefined ? {} : { notes: topic.notesCount }),
        ...(topic.sideThreadIds === undefined || topic.sideThreadIds.length === 0
          ? {}
          : { sideThreadIds: topic.sideThreadIds.map(String) }),
      };
    });
}

const two = (value: number) => String(value).padStart(2, "0");

export const localDate = (now: Date) =>
  `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;

export const localTime = (now: Date) => `${two(now.getHours())}:${two(now.getMinutes())}`;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Monday 23 November" for a `YYYY-MM-DD` day; the day as given when it is not one. */
export function friendlyDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return date;
  // Noon, so a clock change never lands it on the day before or after.
  const at = new Date(year, month - 1, day, 12);
  const weekday = WEEKDAYS[at.getDay()];
  const monthName = MONTHS[at.getMonth()];
  return weekday === undefined || monthName === undefined
    ? date
    : `${weekday} ${at.getDate()} ${monthName}`;
}

/**
 * `index` is the line's place in the note, which also tells two equal lines apart. `depth` is how
 * far a line sits under the list items above it.
 */
export type NoteLine = { readonly text: string; readonly index: number } & (
  | { readonly kind: "heading"; readonly level: number }
  | { readonly kind: "text" | "bullet"; readonly depth: number }
  | { readonly kind: "todo"; readonly done: boolean; readonly depth: number }
);

const TODO = /^(\s*(?:[-*+]|\d+[.)]) \[)([ xX])(\] )(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*(?:```|~~~)/;

/** Markdown's marks taken off a line: emphasis, code ticks, and a link down to its text. */
export const plain = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/(\*\*|__|`|~~)/g, "");

const indentOf = (line: string) => (/^\s*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;

/** A day's note as Today lists it: headings, to-dos that can be ticked, and everything else. */
export function noteLines(content: string): ReadonlyArray<NoteLine> {
  const lines: Array<NoteLine> = [];
  let frontmatter = content.startsWith("---\n");
  // The indents of the list items a line could sit under, outermost first.
  let parents: Array<number> = [];
  content.split("\n").forEach((line, index) => {
    if (frontmatter) {
      if (index > 0 && line.trim() === "---") frontmatter = false;
      return;
    }
    if (line.trim().length === 0 || RULE.test(line) || FENCE.test(line)) return;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      parents = [];
      lines.push({
        kind: "heading",
        text: plain(heading[2] ?? ""),
        level: (heading[1] ?? "").length,
        index,
      });
      return;
    }
    const indent = indentOf(line);
    const todo = TODO.exec(line);
    const bullet = todo ? null : /^\s*[-*+] (.*)$/.exec(line);
    if (todo || bullet) {
      parents = parents.filter((parent) => parent < indent);
      const depth = parents.length;
      parents.push(indent);
      lines.push(
        todo
          ? { kind: "todo", text: plain(todo[4] ?? ""), done: todo[2] !== " ", depth, index }
          : { kind: "bullet", text: plain(bullet?.[1] ?? ""), depth, index },
      );
      return;
    }
    if (indent === 0) parents = [];
    lines.push({
      kind: "text",
      text: plain(line.trim()),
      depth: parents.filter((parent) => parent < indent).length,
      index,
    });
  });
  return lines;
}

export type NoteBodyLine = Exclude<NoteLine, { readonly kind: "heading" }> | NoteSubheading;
type NoteSubheading = Extract<NoteLine, { readonly kind: "heading" }>;

/** A stretch of the note under one main heading; `index` is that heading's line, or -1 before any. */
export interface NoteSection {
  readonly index: number;
  readonly title: string | null;
  readonly lines: ReadonlyArray<NoteBodyLine>;
}

/**
 * The note grouped under its main headings (`#` and `##`); smaller headings stay inside their
 * group. A heading that only names the day is left out: the screen says the day itself.
 */
export function noteSections(content: string, date: string): ReadonlyArray<NoteSection> {
  const sections: Array<{ index: number; title: string | null; lines: Array<NoteBodyLine> }> = [];
  const day = friendlyDate(date).toLowerCase();
  for (const line of noteLines(content)) {
    if (line.kind === "heading" && line.level <= 2) {
      const title = line.text.trim();
      if (title === date || title.toLowerCase().replace(/,/g, "") === day) continue;
      sections.push({ index: line.index, title, lines: [] });
      continue;
    }
    const current = sections[sections.length - 1];
    if (current) current.lines.push(line);
    else sections.push({ index: -1, title: null, lines: [line] });
  }
  return sections;
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
