import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { scheduleTimeZoneLabel } from "@t3tools/client-runtime/scheduled-task-time-zone";
import type {
  EnvironmentId,
  MajordomeRoutinesRunner,
  MajordomeRoutinesStatus,
  ProjectId,
  ScheduledTask,
  ScheduledTaskRunStatus,
  ScheduledTaskSchedule,
  ThreadId,
} from "@t3tools/contracts";

/** How a routine's last run went, in the owner's words. */
export const ROUTINE_LAST_RUN: Record<
  Exclude<ScheduledTaskRunStatus, "never">,
  { readonly tone: "ok" | "neutral" | "error"; readonly text: string }
> = {
  succeeded: { tone: "ok", text: "Last run went well" },
  failed: { tone: "error", text: "Last run couldn't finish" },
  running: { tone: "neutral", text: "Running now" },
};

/**
 * What the Routines screen calls a scheduled task. A one-time task is a reminder whoever made it,
 * and is `done` once it has fired or been turned off; `outside` runs when another service calls it.
 */
export type RoutineKind = "routine" | "reminder" | "done" | "outside";

export function routineKind(
  task: Pick<ScheduledTask, "schedule" | "enabled" | "nextRunAt">,
): RoutineKind {
  if (task.schedule.type === "webhook") return "outside";
  if (task.schedule.type !== "once") return "routine";
  return task.enabled && task.nextRunAt !== null ? "reminder" : "done";
}

type CopyRef = { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };

export interface RoutineItem {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  /** The server's zone, for a time of day that is not the reader's own. */
  readonly timeZone: string | undefined;
}

/**
 * The notes folder's routines and upcoming reminders. Every server keeps its own copy of the
 * routines and only the runner's fire, so routines come from that server alone; a reminder is on
 * the one server it was asked on, so reminders come from all of them, soonest first.
 */
export function selectRoutines(input: {
  /** Each server's copy of the notes folder with what that server has scheduled. */
  readonly copies: ReadonlyArray<
    CopyRef & {
      readonly tasks: ReadonlyArray<ScheduledTask> | null;
      readonly timeZone?: string | undefined;
    }
  >;
  /** The copy on the server that runs the routines. */
  readonly runner: CopyRef | null;
}): {
  readonly routines: ReadonlyArray<RoutineItem>;
  readonly reminders: ReadonlyArray<RoutineItem>;
  /** Reminders that went off, which only the calendar still shows. */
  readonly fired: ReadonlyArray<RoutineItem>;
} {
  const routines: Array<RoutineItem> = [];
  const reminders: Array<RoutineItem> = [];
  const fired: Array<RoutineItem> = [];
  for (const copy of input.copies) {
    const isRunner =
      input.runner !== null &&
      copy.environmentId === input.runner.environmentId &&
      copy.projectId === input.runner.projectId;
    for (const task of copy.tasks ?? []) {
      if (task.projectId !== copy.projectId) continue;
      const kind = routineKind(task);
      const item = {
        key: `${copy.environmentId}:${task.id}`,
        environmentId: copy.environmentId,
        task,
        timeZone: copy.timeZone,
      };
      if (kind === "reminder") reminders.push(item);
      else if (kind === "done") {
        if (task.lastRunAt !== null) fired.push(item);
      } else if (isRunner) routines.push(item);
    }
  }
  return {
    routines,
    fired,
    reminders: reminders.toSorted(
      (left, right) =>
        Date.parse(left.task.nextRunAt ?? "") - Date.parse(right.task.nextRunAt ?? "") ||
        left.key.localeCompare(right.key),
    ),
  };
}

/**
 * `scopedThreadKey`s of the chats that are a routine's, which Recent leaves out: the one each
 * routine keeps, and the chats routines opened on every run before they kept one. Those carry the
 * routine's name and were not started by the owner, on whichever server ran the routine then.
 */
export function routineThreadKeys(
  routines: ReadonlyArray<RoutineItem>,
  threads: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly title: string;
    readonly source: { readonly createdBy: string };
  }>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  const runTitles = new Set<string>();
  for (const { environmentId, task } of routines) {
    runTitles.add(task.title);
    if (task.threadId !== null) {
      keys.add(scopedThreadKey({ environmentId, threadId: task.threadId }));
    }
  }
  for (const thread of threads) {
    if (thread.source.createdBy !== "user" && runTitles.has(thread.title)) {
      keys.add(scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }));
    }
  }
  return keys;
}

/**
 * The topic each routine posts in, by routine key: the topic whose conversation, on the routine's
 * own server, is the one the routine is tied to. `copies` are the servers' copies kept apart,
 * since each server has its own conversation per topic.
 */
export function routineTopicIds(
  routines: ReadonlyArray<RoutineItem>,
  copies: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly topics: ReadonlyArray<{ readonly id: string; readonly threadId: ThreadId | null }>;
  }>,
): ReadonlyMap<string, string> {
  const topicByThreadKey = new Map<string, string>();
  for (const copy of copies) {
    for (const topic of copy.topics) {
      if (topic.threadId === null) continue;
      topicByThreadKey.set(
        scopedThreadKey({ environmentId: copy.environmentId, threadId: topic.threadId }),
        topic.id,
      );
    }
  }
  const topicIds = new Map<string, string>();
  for (const item of routines) {
    if (item.task.threadId === null) continue;
    const topicId = topicByThreadKey.get(
      scopedThreadKey({ environmentId: item.environmentId, threadId: item.task.threadId }),
    );
    if (topicId !== undefined) topicIds.set(item.key, topicId);
  }
  return topicIds;
}

/** The few reminders Today shows: the soonest ones. */
export function selectComingUp(
  reminders: ReadonlyArray<RoutineItem>,
  max = 3,
): ReadonlyArray<RoutineItem> {
  return reminders.slice(0, max);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, as a week is read. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function listWords(words: ReadonlyArray<string>): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function everyWords(everyMs: number): string {
  const minutes = Math.round(everyMs / 60_000);
  if (minutes < 1) return "Every few seconds";
  const [count, unit] =
    minutes % 1_440 === 0
      ? [minutes / 1_440, "day"]
      : minutes % 60 === 0
        ? [minutes / 60, "hour"]
        : [minutes, "minute"];
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`;
}

/** The 24-hour "09:30" a schedule stores, as the reader's locale writes a time: "9:30" or "9:30 AM". */
function plainTime(timeOfDay: string, locale?: string): string {
  const [hour = 0, minute = 0] = timeOfDay.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(2000, 0, 1, hour, minute));
}

/** A date and time in the reader's own zone: "Tue 17 Nov, 10:00". */
export function plainDateTime(iso: string, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(iso));
}

/**
 * When a routine runs, in plain words: "Every day at 8:00", "Sundays at 18:00", "Every 2 hours".
 * A time of day is the server's, so its zone is named when the reader is somewhere else.
 */
export function routineScheduleWords(
  schedule: ScheduledTaskSchedule,
  options: {
    readonly serverTimeZone?: string | undefined;
    /** The reader's zone; the browser's when left out. */
    readonly readerTimeZone?: string | undefined;
    readonly locale?: string | undefined;
  } = {},
): string {
  if (schedule.type === "webhook") return "When something arrives";
  if (schedule.type === "interval") return everyWords(schedule.everyMs);
  if (schedule.type === "once") {
    return `Once, ${plainDateTime(schedule.runAt, options.locale, options.readerTimeZone)}`;
  }
  const days = WEEK_ORDER.filter((day) => schedule.weekdays?.includes(day));
  const when =
    days.length === 0 || days.length === 7
      ? "Every day"
      : days.length === 5 && days.every((day) => day >= 1 && day <= 5)
        ? "Weekdays"
        : listWords(days.map((day) => `${WEEKDAYS[day]}s`));
  const reader =
    options.readerTimeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone ?? undefined;
  const zone =
    options.serverTimeZone !== undefined && options.serverTimeZone !== reader
      ? scheduleTimeZoneLabel(options.serverTimeZone)
      : undefined;
  return `${when} at ${plainTime(schedule.timeOfDay, options.locale)}${zone === undefined ? "" : ` (${zone})`}`;
}

/** "in 20 minutes", "in 3 hours", "in 2 days": how long until something upcoming. */
export function untilWords(iso: string, nowMs: number): string {
  const minutes = Math.ceil((Date.parse(iso) - nowMs) / 60_000);
  if (!(minutes >= 1)) return "any moment now";
  const plural = (count: number, unit: string) => `in ${count} ${unit}${count === 1 ? "" : "s"}`;
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.round(hours / 24), "day");
}

/**
 * Why none of a notes folder's routines will run for now: today's runs are used up, no computer
 * runs them, or the AI they use can't be reached. Null when they run.
 */
export type RoutinesHold = "paused" | "nowhere" | "blocked";

export function routinesHold(
  history: {
    readonly routinesRunner: MajordomeRoutinesRunner;
    readonly pausedToday?: boolean | undefined;
    readonly routinesStatus?: MajordomeRoutinesStatus | undefined;
  } | null,
): RoutinesHold | null {
  if (history === null) return null;
  if (history.routinesRunner === "none") return "nowhere";
  const status = history.routinesStatus;
  // "not-created" clears by itself at the server's next check.
  if (status !== undefined && !status.ready && status.reason !== "not-created") return "blocked";
  return history.pausedToday === true ? "paused" : null;
}

export const ROUTINES_NOWHERE_TEXT = "Routines don't run on any computer yet";

/** The line for routines that wait for tomorrow; `runsPerDay` is null when the number is unknown. */
export function routinesPausedText(runsPerDay: number | null): string {
  return `Routines are paused until tomorrow: they used today's ${runsPerDay === null ? "" : `${runsPerDay} `}runs`;
}

const HOLD_WORDS: Record<RoutinesHold, string> = {
  paused: "Paused until tomorrow",
  nowhere: "Not running",
  blocked: "Not running",
};

/** The line under a routine's name: when it runs, then whether it is on and when it runs next. */
export function routineWhenLine(
  task: Pick<ScheduledTask, "schedule" | "enabled" | "nextRunAt" | "blockedByPolicy">,
  nowMs: number,
  options?: Parameters<typeof routineScheduleWords>[1] & {
    /** Set while none of the routines run, so the line does not promise a next run. */
    readonly hold?: RoutinesHold | null | undefined;
  },
): string {
  const words = routineScheduleWords(task.schedule, options);
  if (task.blockedByPolicy !== undefined) return `${words} · ${task.blockedByPolicy}`;
  if (!task.enabled) return `${words} · Off`;
  if (options?.hold != null) return `${words} · ${HOLD_WORDS[options.hold]}`;
  if (task.schedule.type === "webhook" || task.nextRunAt === null) return words;
  return `${words} · Next ${untilWords(task.nextRunAt, nowMs)}`;
}

const dayKey = (ms: number, timeZone: string | undefined) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(ms);

const DAY_MS = 86_400_000;

/** When something happened, for the reader: "today 8:00", "yesterday 8:00", "Tue 17 Nov, 8:00". */
export function sinceWords(iso: string, nowMs: number, locale?: string, timeZone?: string): string {
  const at = Date.parse(iso);
  const day = dayKey(at, timeZone);
  const near =
    day === dayKey(nowMs, timeZone)
      ? "today"
      : day === dayKey(nowMs - DAY_MS, timeZone)
        ? "yesterday"
        : null;
  if (near === null) return plainDateTime(iso, locale, timeZone);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(at);
  return `${near} ${time}`;
}

/**
 * The run a fixed-time routine last skipped, as "on Tue at 8:00": the slot before its next run,
 * since the server keeps no time for a run it missed. Null when the schedule has no such slot.
 */
function skippedSlotWords(
  task: Pick<ScheduledTask, "schedule" | "nextRunAt">,
  serverTimeZone: string | undefined,
): string | null {
  const { schedule } = task;
  if (schedule.type !== "fixed_time" || task.nextRunAt === null) return null;
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    ...(serverTimeZone === undefined ? {} : { timeZone: serverTimeZone }),
  });
  const next = Date.parse(task.nextRunAt);
  const everyDay = schedule.weekdays === undefined || schedule.weekdays.length === 0;
  for (let daysBack = 1; daysBack <= 7; daysBack++) {
    const name = weekday.format(next - daysBack * DAY_MS);
    if (
      everyDay ||
      schedule.weekdays?.includes(WEEKDAYS.findIndex((day) => day.startsWith(name)))
    ) {
      return `on ${name} at ${plainTime(schedule.timeOfDay)}`;
    }
  }
  return null;
}

export interface RoutineLastRun {
  readonly tone: "ok" | "neutral" | "warning" | "error";
  readonly text: string;
  /** What the owner can do about a run that was skipped. */
  readonly remedy?: "run-now" | "open-chat";
  /** What the server said went wrong, when it is not a cause this screen words itself. */
  readonly details?: string;
}

/** How a routine's last run went and when, in the owner's words; null before its first run. */
export function routineLastRun(
  task: Pick<
    ScheduledTask,
    "schedule" | "nextRunAt" | "lastRunAt" | "lastRunStatus" | "lastRunError" | "lastRunErrorCode"
  >,
  nowMs: number,
  options: {
    readonly serverTimeZone?: string | undefined;
    readonly readerTimeZone?: string | undefined;
    readonly locale?: string | undefined;
  } = {},
): RoutineLastRun | null {
  const when =
    task.lastRunAt === null
      ? ""
      : ` · ${sinceWords(task.lastRunAt, nowMs, options.locale, options.readerTimeZone)}`;
  if (task.lastRunStatus === "running") return { tone: "neutral", text: "Running now" };
  if (task.lastRunStatus === "succeeded") {
    return { tone: "ok", text: `${ROUTINE_LAST_RUN.succeeded.text}${when}` };
  }
  if (task.lastRunStatus === "never" && task.lastRunError === null) return null;
  if (task.lastRunErrorCode === "missed") {
    const slot = skippedSlotWords(task, options.serverTimeZone);
    return {
      tone: "warning",
      text: `Skipped ${slot ?? "a run"}: the computer was asleep or off`,
      remedy: "run-now",
    };
  }
  if (task.lastRunErrorCode === "held") {
    return {
      tone: "warning",
      text: "Skipped a run: an earlier one is still waiting in its chat",
      remedy: "open-chat",
    };
  }
  if (task.lastRunErrorCode === "stopped") {
    return { tone: "neutral", text: `Last run was stopped${when}` };
  }
  return {
    tone: "error",
    text: `${ROUTINE_LAST_RUN.failed.text}${when}`,
    ...(task.lastRunError ? { details: task.lastRunError } : {}),
  };
}

/** What the owner would write to change a routine; they finish the sentence. */
export function changeRoutineMessage(title: string): string {
  return `I'd like to change my routine “${title}”: `;
}

/** What the owner would write to set up their first routine; they finish the sentence. */
export const NEW_ROUTINE_MESSAGE = "I'd like a new routine: ";
