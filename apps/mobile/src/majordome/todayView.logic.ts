import { friendlyDate, localDate, type NoteLine, type NoteSection } from "./today.logic";

const parts = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year + month + day)
    ? null
    : { year, month, day };
};

/** The `YYYY-MM-DD` day that many days away; the day as given when it is not one. */
export function shiftDay(date: string, days: number): string {
  const at = parts(date);
  // Noon, so a clock change never lands it on the day before or after.
  return at === null ? date : localDate(new Date(at.year, at.month - 1, at.day + days, 12));
}

/** How far a day is from today, in words; null for today itself. */
export function dayFromToday(date: string, today: string): string | null {
  const from = parts(today);
  const to = parts(date);
  if (from === null || to === null) return null;
  const days = Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  );
  if (days === 0) return null;
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  return days < 0 ? `${-days} days ago` : `In ${days} days`;
}

/** The day as the screen's title, with its year only when that is not this year. */
export function dayTitle(date: string, today: string): string {
  const year = date.slice(0, 4);
  const title = friendlyDate(date);
  return title === date || year === today.slice(0, 4) ? title : `${title} ${year}`;
}

/** How many of the note's to-dos are ticked; null when it has none. */
export function todoProgress(
  sections: ReadonlyArray<NoteSection>,
): { readonly done: number; readonly total: number } | null {
  let done = 0;
  let total = 0;
  for (const section of sections) {
    for (const line of section.lines) {
      if (line.kind !== "todo") continue;
      total += 1;
      if (line.done) done += 1;
    }
  }
  return total === 0 ? null : { done, total };
}

export type TodoLine = Extract<NoteLine, { readonly kind: "todo" }>;

/**
 * A day's note as one sheet: its to-dos gathered from every heading, those left before those
 * done, and the rest as the journal under the note's own headings. A heading left with nothing
 * under it is dropped.
 */
export function daySheet(sections: ReadonlyArray<NoteSection>): {
  readonly todos: ReadonlyArray<TodoLine>;
  readonly journal: ReadonlyArray<NoteSection>;
} {
  const todos: Array<TodoLine> = [];
  const journal: Array<NoteSection> = [];
  for (const section of sections) {
    const rest = section.lines.filter((line) => {
      if (line.kind === "todo") todos.push(line);
      return line.kind !== "todo";
    });
    const lines = rest.filter(
      (line, index) =>
        line.kind !== "heading" ||
        (rest[index + 1] !== undefined && rest[index + 1]?.kind !== "heading"),
    );
    if (lines.length > 0) journal.push({ ...section, lines });
  }
  return {
    todos: [...todos.filter((todo) => !todo.done), ...todos.filter((todo) => todo.done)],
    journal,
  };
}

/** A line that starts with the time it was written, as the ones added from the phone do. */
export function timedLine(text: string): { readonly time: string; readonly text: string } | null {
  const found = /^(\d{1,2}:\d{2})\s+(.+)$/.exec(text);
  return found ? { time: found[1] ?? "", text: found[2] ?? "" } : null;
}

export type ComputerReach = "connected" | "connecting" | "unreachable";

/** Whether a computer can be talked to now, from its connection as the app reports it. */
export function computerReach(phase: string | undefined, phoneOffline: boolean): ComputerReach {
  if (phoneOffline) return "unreachable";
  // A first try is still "connecting"; one that already dropped or failed is unreachable.
  return phase === "connected" || phase === "connecting" ? phase : "unreachable";
}

export type TodaySetup =
  /** Nothing is known yet; say nothing rather than guess. */
  "starting" | "noComputer" | "unreachable" | "looking" | "noFolder" | "ready";

/** What Today has to work with: a notes folder to show, or the one thing missing. */
export function todaySetup(input: {
  readonly storeLoaded: boolean;
  readonly connections: "loading" | "none" | "some";
  /** A notes folder is known, from the computer or from this phone's copy. */
  readonly hasFolder: boolean;
  /** That folder's computer is still one this phone knows. */
  readonly folderComputerKnown: boolean;
  readonly anyConnected: boolean;
  readonly anyConnecting: boolean;
  /** A connected computer has not finished saying what it holds. */
  readonly searching: boolean;
}): TodaySetup {
  if (!input.storeLoaded) return "starting";
  if (input.connections === "loading") return input.hasFolder ? "ready" : "starting";
  if (input.connections === "none") return "noComputer";
  if (input.hasFolder && input.folderComputerKnown) return "ready";
  if (input.anyConnected) return input.searching ? "looking" : "noFolder";
  return input.anyConnecting ? "looking" : "unreachable";
}

export interface NoteStatus {
  /** Why the note on screen may be old or missing; null when it is the computer's own. */
  readonly notice: "connecting" | "unreachable" | "failed" | null;
  readonly canTick: boolean;
  /** What to say where the note would be when there is nothing to list. */
  readonly empty: "nothing" | "getting" | "later" | null;
}

/** What to say around a day's note, from the connection and the last read of it. */
export function noteStatus(input: {
  readonly reach: ComputerReach;
  readonly read: "answered" | "failed" | "waiting";
  /** A note is on screen, the computer's or this phone's copy of it. */
  readonly hasNote: boolean;
}): NoteStatus {
  const { reach, read } = input;
  const notice = reach !== "connected" ? reach : read === "failed" ? "failed" : null;
  // The phone's copy may be old: a tick is only taken on a note the computer just gave.
  const canTick = reach === "connected" && read === "answered";
  const empty =
    read === "answered" || input.hasNote
      ? "nothing"
      : notice === "failed"
        ? null
        : notice === null
          ? "getting"
          : "later";
  return { notice, canTick, empty };
}
