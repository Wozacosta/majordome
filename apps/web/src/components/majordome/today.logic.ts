import { type EnvironmentId, type ServerProvider, ThreadId } from "@t3tools/contracts";

import {
  classifyFeedEntry,
  type FeedItem,
  feedRunSummary,
  type FeedVault,
  type FeedVaultNotes,
} from "./feed.logic";

/**
 * True when the computer's AI accounts are known and none could answer a chat: each is off, not
 * installed, signed out or failing. Not known yet (undefined) is not "not set up".
 */
export function assistantNotSetUp(
  providers:
    | ReadonlyArray<
        Pick<ServerProvider, "enabled" | "installed" | "status" | "availability" | "auth">
      >
    | undefined,
): boolean {
  if (providers === undefined) return false;
  return !providers.some(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      (provider.status === "ready" || provider.status === "warning") &&
      provider.availability !== "unavailable" &&
      provider.auth.status !== "unauthenticated",
  );
}

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

/** The greeting for an hour of the day (0-23); the small hours still read as the evening. */
export function greetingForHour(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Monday, 16 November" as the locale writes it; the browser's own locale when none is given. */
export function todayTitle(now: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    now,
  );
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A day on the device's calendar as `YYYY-MM-DD`, which is how its daily note is named. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Noon of that day, so a clock change never lands it on the day before or after. */
export function dateOfDay(key: string): Date {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function shiftDay(key: string, days: number): string {
  const date = dateOfDay(key);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

/** The seven days of that day's week, Monday first. */
export function weekOf(key: string): ReadonlyArray<string> {
  const sinceMonday = (dateOfDay(key).getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => shiftDay(key, index - sinceMonday));
}

export interface OpenTask {
  /** Where the box's `[` sits in the note, which is what ticking it needs. */
  readonly markerOffset: number;
  readonly text: string;
}

const OPEN_TASK = /^(\s*[-*+]\s+)\[ \]\s+(\S.*?)\s*$/;
const CODE_FENCE = /^\s*(?:```|~~~)/;

/** A note's unticked checkboxes outside code blocks, in the note's order. */
export function openTasks(content: string): ReadonlyArray<OpenTask> {
  const tasks: Array<OpenTask> = [];
  let offset = 0;
  let fenced = false;
  for (const line of content.split("\n")) {
    if (CODE_FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const match = OPEN_TASK.exec(line);
      if (match) tasks.push({ markerOffset: offset + match[1]!.length, text: match[2]! });
    }
    offset += line.length + 1;
  }
  return tasks;
}

/** `HH:MM` on the device's clock, written before a line added to the daily note. */
export function timeOfDay(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface TodayRun {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  /** The run's chat; null when the notes' history does not say which one it was. */
  readonly threadId: ThreadId | null;
  readonly title: string;
  readonly at: string;
  readonly summary: string | null;
}

const threadKey = (environmentId: EnvironmentId, threadId: string) =>
  `${environmentId}:${threadId}`;

/**
 * What Majordome's latest runs did, newest first. A chat appears once, and a topic's conversation
 * not at all: topics have their own list. Runs that need the owner are above, with the chats that
 * are going on.
 */
export function selectTodayRuns(input: {
  /** `buildFeedItems`: the changes to the notes. */
  readonly changes: ReadonlyArray<FeedItem>;
  readonly notesOf: (vault: FeedVault) => FeedVaultNotes;
  /** `${environmentId}:${threadId}` of each topic's conversation. */
  readonly topicThreads?: ReadonlySet<string>;
  readonly max?: number;
}): ReadonlyArray<TodayRun> {
  const { topicThreads = new Set<string>(), max = 4 } = input;
  const shownThreads = new Set<string>();
  const results: Array<TodayRun> = [];
  for (const item of input.changes.toSorted(
    (left, right) => Date.parse(right.entry.committedAt) - Date.parse(left.entry.committedAt),
  )) {
    const { entry, vault } = item;
    if (item.undone || classifyFeedEntry(entry) !== "run") continue;
    if (entry.threadId !== null) {
      const key = threadKey(vault.environmentId, entry.threadId);
      if (topicThreads.has(key) || shownThreads.has(key)) continue;
      shownThreads.add(key);
    }
    results.push({
      key: `change:${item.key}`,
      environmentId: vault.environmentId,
      threadId: entry.threadId === null ? null : ThreadId.make(entry.threadId),
      title: item.title,
      at: entry.committedAt,
      summary: feedRunSummary(entry, input.notesOf(vault)),
    });
  }
  return results.slice(0, max);
}

/**
 * Ways in for someone facing Today's empty box. A whole request is sent as it is; the start of a
 * sentence waits in the box for the owner to finish it.
 */
export const TODAY_STARTERS = [
  { label: "Remember something", text: "Remember that ", send: false },
  { label: "Ask about my notes", text: "What do my notes say about ", send: false },
  { label: "Remind me", text: "Remind me to ", send: false },
  { label: "Plan my day", text: "Help me plan my day.", send: true },
] as const;

/**
 * What the box holds after a starter is pressed, and whether it is sent at once. A starter fills
 * an empty box or replaces another starter; words the owner typed stay, after it, and are theirs
 * to send.
 */
export function pickTodayStarter(
  typed: string,
  starter: (typeof TODAY_STARTERS)[number],
): { readonly text: string; readonly send: boolean } {
  const untouched =
    typed.trim() === "" ||
    TODAY_STARTERS.some((candidate) => candidate.text.trim() === typed.trim());
  if (untouched) return { text: starter.text, send: starter.send };
  // A whole sentence needs a space before the owner's own words.
  const lead = starter.text.endsWith(" ") ? starter.text : `${starter.text} `;
  return { text: `${lead}${typed}`, send: false };
}
