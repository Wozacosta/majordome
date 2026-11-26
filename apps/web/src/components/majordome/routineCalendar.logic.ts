import type { MajordomeRoutineRun, ScheduledTask } from "@t3tools/contracts";
import { nextScheduledRunAt } from "@t3tools/shared/scheduledTaskSchedule";
import * as DateTime from "effect/DateTime";

import type { RoutineItem, RoutinesHold } from "./routines.logic";

/**
 * How a run on the calendar went. Each is something the server said: a run that started and how it
 * ended, a run it skipped, or a run its schedule still holds.
 */
export type CalendarRunState = "done" | "failed" | "skipped" | "stopped" | "running" | "upcoming";

export interface CalendarRun {
  readonly key: string;
  readonly item: RoutineItem;
  readonly reminder: boolean;
  readonly atMs: number;
  readonly state: CalendarRunState;
  /** More than 1 when a routine that runs many times a day is shown once. */
  readonly count: number;
}

export interface CalendarDay {
  /** The day in the reader's zone, as "2026-11-26". */
  readonly key: string;
  readonly startMs: number;
  readonly today: boolean;
  readonly runs: ReadonlyArray<CalendarRun>;
}

const readerZone = () => new Intl.DateTimeFormat().resolvedOptions().timeZone;

function zoned(ms: number, timeZone: string | undefined): DateTime.DateTime {
  return DateTime.makeZonedUnsafe(ms, { timeZone: timeZone ?? readerZone() });
}

const startOfDay = (day: DateTime.DateTime) =>
  DateTime.setParts(day, { hour: 0, minute: 0, second: 0, millisecond: 0 });

/**
 * The starts of the eight days that bound a week, Monday first, in the reader's zone: the week
 * `weeksFromNow` weeks away from the one `nowMs` is in. A day is not always 24 hours.
 */
export function weekBounds(
  nowMs: number,
  weeksFromNow: number,
  timeZone?: string,
): ReadonlyArray<number> {
  const now = zoned(nowMs, timeZone);
  const sinceMonday = (DateTime.toParts(now).weekDay + 6) % 7;
  return Array.from({ length: 8 }, (_, day) =>
    DateTime.toEpochMillis(
      startOfDay(DateTime.add(now, { days: day - sinceMonday + weeksFromNow * 7 })),
    ),
  );
}

const MAX_STEPS = 20_000;

/**
 * When a routine or reminder will run from `fromMs` up to `untilMs`. The first is the run the
 * server has planned; the ones after it follow its schedule, read in the server's zone.
 */
export function upcomingRunTimes(
  task: Pick<ScheduledTask, "schedule" | "enabled" | "nextRunAt">,
  range: {
    readonly fromMs: number;
    readonly untilMs: number;
    readonly serverTimeZone?: string | undefined;
  },
): ReadonlyArray<number> {
  if (!task.enabled || task.nextRunAt === null) return [];
  const { schedule } = task;
  const first = Date.parse(task.nextRunAt);
  if (!Number.isFinite(first)) return [];
  const times: Array<number> = [];
  let at = first;
  if (first < range.fromMs) {
    if (schedule.type === "interval") {
      at = first + Math.ceil((range.fromMs - first) / schedule.everyMs) * schedule.everyMs;
    } else {
      const next = nextScheduledRunAt(schedule, zoned(range.fromMs - 1, range.serverTimeZone));
      if (next === null) return [];
      at = DateTime.toEpochMillis(next);
    }
  }
  for (let step = 0; step < MAX_STEPS && at < range.untilMs; step += 1) {
    times.push(at);
    const next = nextScheduledRunAt(schedule, zoned(at, range.serverTimeZone));
    if (next === null) break;
    at = DateTime.toEpochMillis(next);
  }
  return times;
}

function runState(run: Pick<MajordomeRoutineRun, "status" | "errorCode">): CalendarRunState {
  if (run.status === "running") return "running";
  if (run.status === "succeeded") return "done";
  if (run.errorCode === "missed" || run.errorCode === "held") return "skipped";
  return run.errorCode === "stopped" ? "stopped" : "failed";
}

/** A routine that runs more often than this in a day takes one line there. */
const MAX_PER_DAY = 3;

function collapse(runs: ReadonlyArray<CalendarRun>): ReadonlyArray<CalendarRun> {
  const groups = new Map<string, Array<CalendarRun>>();
  for (const run of runs) {
    const key = `${run.item.key}\n${run.state === "upcoming" ? "upcoming" : "past"}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()]
    .flatMap((group) => {
      if (group.length <= MAX_PER_DAY) return group;
      const upcoming = group[0]!.state === "upcoming";
      // Coming runs stand at the first of them; past ones at the last, failed if any of them did.
      const shown = upcoming ? group[0]! : group.at(-1)!;
      const failed = group.find((run) => run.state === "failed");
      return [{ ...shown, state: failed?.state ?? shown.state, count: group.length }];
    })
    .toSorted((left, right) => left.atMs - right.atMs || left.key.localeCompare(right.key));
}

/**
 * A week of runs, day by day: the ones that happened, from each server's log and each routine's
 * last run, and the ones still to come, from each schedule.
 */
export function buildWeek(input: {
  /** From `weekBounds`. */
  readonly bounds: ReadonlyArray<number>;
  readonly nowMs: number;
  readonly routines: ReadonlyArray<RoutineItem>;
  readonly reminders: ReadonlyArray<RoutineItem>;
  /** Reminders that went off. */
  readonly fired?: ReadonlyArray<RoutineItem>;
  /** Logged runs, each with the `RoutineItem.key` of its routine or reminder. */
  readonly logged?: ReadonlyArray<{
    readonly itemKey: string;
    readonly run: MajordomeRoutineRun;
  }>;
  /** Set while none of the routines run; reminders still go off. */
  readonly hold?: RoutinesHold | null;
  /** The reader's zone, which the bounds were made in; the browser's when left out. */
  readonly timeZone?: string | undefined;
}): ReadonlyArray<CalendarDay> {
  const fromMs = input.bounds[0]!;
  const untilMs = input.bounds.at(-1)!;
  const reminderKeys = new Set([...input.reminders, ...(input.fired ?? [])].map((it) => it.key));
  const items = new Map(
    [...input.routines, ...input.reminders, ...(input.fired ?? [])].map((it) => [it.key, it]),
  );
  const runs = new Map<string, CalendarRun>();
  const add = (item: RoutineItem, atMs: number, state: CalendarRunState) => {
    if (!(atMs >= fromMs && atMs < untilMs)) return;
    const key = `${item.key}\n${atMs}`;
    runs.set(key, { key, item, reminder: reminderKeys.has(item.key), atMs, state, count: 1 });
  };

  for (const { itemKey, run } of input.logged ?? []) {
    const item = items.get(itemKey);
    if (item !== undefined) add(item, Date.parse(run.at), runState(run));
  }
  for (const item of items.values()) {
    const { task } = item;
    // The live list knows a run's latest status before the log is read again.
    const skipped = task.lastRunErrorCode === "missed" || task.lastRunErrorCode === "held";
    if (task.lastRunAt !== null && task.lastRunStatus !== "never" && !skipped) {
      add(
        item,
        Date.parse(task.lastRunAt),
        runState({ status: task.lastRunStatus, errorCode: task.lastRunErrorCode }),
      );
    }
    const reminder = reminderKeys.has(item.key);
    if (!reminder && (input.hold === "nowhere" || input.hold === "blocked")) continue;
    // Paused routines start again tomorrow.
    const resumeMs =
      !reminder && input.hold === "paused"
        ? (input.bounds.find((start) => start > input.nowMs) ?? untilMs)
        : fromMs;
    for (const atMs of upcomingRunTimes(task, {
      fromMs: Math.max(fromMs, resumeMs),
      untilMs,
      serverTimeZone: item.timeZone,
    })) {
      add(item, atMs, "upcoming");
    }
  }

  const all = [...runs.values()];
  return input.bounds.slice(0, 7).map((startMs, index) => {
    const endMs = input.bounds[index + 1]!;
    return {
      key: new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: input.timeZone ?? readerZone(),
      }).format(startMs),
      startMs,
      today: input.nowMs >= startMs && input.nowMs < endMs,
      runs: collapse(all.filter((run) => run.atMs >= startMs && run.atMs < endMs)),
    };
  });
}

/** "23 – 29 Nov 2026", as the reader's locale writes a range of days. */
export function weekRangeWords(
  bounds: ReadonlyArray<number>,
  locale?: string,
  timeZone?: string,
): string {
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  // The last bound is the next week's first moment.
  return format.formatRange(bounds[0]!, bounds.at(-1)! - 1);
}

/** A run's time of day for the reader: "8:00" or "8:00 AM". */
export function runTimeWords(atMs: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(atMs);
}

export const CALENDAR_RUN_STATE_WORDS: Record<CalendarRunState, string> = {
  done: "Done",
  failed: "Couldn't finish",
  skipped: "Skipped",
  stopped: "Stopped",
  running: "Running now",
  upcoming: "Coming up",
};
