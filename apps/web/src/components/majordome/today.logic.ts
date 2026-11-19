import { type EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  classifyFeedEntry,
  type FeedItem,
  type FeedRunItem,
  type FeedRunStatus,
  feedRunSummary,
  type FeedVault,
  type FeedVaultNotes,
} from "./feed.logic";

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
  /** Set while the run needs the owner. */
  readonly status: FeedRunStatus | null;
}

const newestFirst = (left: TodayRun, right: TodayRun) =>
  Date.parse(right.at) - Date.parse(left.at) || left.key.localeCompare(right.key);

const threadKey = (environmentId: EnvironmentId, threadId: string) =>
  `${environmentId}:${threadId}`;

/**
 * The few runs Today shows: those that need the owner first, then what Majordome's latest runs
 * did, each group newest first. A chat appears once, and a topic's conversation not at all: topics
 * have their own list.
 */
export function selectTodayRuns(input: {
  /** `buildFeedRunItems`: runs waiting for the owner, failed or stopped. */
  readonly attention: ReadonlyArray<FeedRunItem>;
  /** `buildFeedItems`: the changes to the notes. */
  readonly changes: ReadonlyArray<FeedItem>;
  readonly notesOf: (vault: FeedVault) => FeedVaultNotes;
  /** `${environmentId}:${threadId}` of each topic's conversation. */
  readonly topicThreads?: ReadonlySet<string>;
  readonly max?: number;
}): ReadonlyArray<TodayRun> {
  const { topicThreads = new Set<string>(), max = 4 } = input;
  const shownThreads = new Set<string>();
  const needsOwner: Array<TodayRun> = [];
  for (const run of input.attention) {
    const key = threadKey(run.vault.environmentId, run.threadId);
    if (topicThreads.has(key)) continue;
    shownThreads.add(key);
    needsOwner.push({
      key: `run:${run.key}`,
      environmentId: run.vault.environmentId,
      threadId: run.threadId,
      title: run.title,
      at: run.at,
      summary: null,
      status: run.status,
    });
  }
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
      status: null,
    });
  }
  return [...needsOwner.toSorted(newestFirst), ...results].slice(0, max);
}
