import { EnvironmentId, ProjectId, type ScheduledTask, ScheduledTaskId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildWeek,
  type CalendarDay,
  upcomingRunTimes,
  weekBounds,
  weekRangeWords,
} from "./routineCalendar.logic";
import type { RoutineItem } from "./routines.logic";

const PARIS = "Europe/Paris";
/** Thursday 26 November 2026, 10:00 in Paris. */
const NOW = Date.parse("2026-11-26T09:00:00.000Z");
const env = EnvironmentId.make("env-mac");

const item = (id: string, overrides: Partial<ScheduledTask> = {}): RoutineItem => ({
  key: `${env}:${id}`,
  environmentId: env,
  timeZone: PARIS,
  task: {
    id: ScheduledTaskId.make(id),
    title: id,
    projectId: ProjectId.make("notes"),
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "08:00" },
    nextRunAt: "2026-11-27T07:00:00.000Z",
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    threadId: null,
    ...overrides,
  } as ScheduledTask,
});

const iso = (times: ReadonlyArray<number>) => times.map((ms) => new Date(ms).toISOString());

/** Each day's runs as "08:00 title state", in Paris time. */
const shown = (days: ReadonlyArray<CalendarDay>) =>
  Object.fromEntries(
    days
      .filter((day) => day.runs.length > 0)
      .map((day) => [
        day.key,
        day.runs.map((run) => {
          const time = new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: PARIS,
          }).format(run.atMs);
          return `${time} ${run.item.task.title} ${run.state}${run.count > 1 ? ` x${run.count}` : ""}`;
        }),
      ]),
  );

describe("weekBounds", () => {
  it("starts the week on Monday in the reader's zone", () => {
    const bounds = weekBounds(NOW, 0, PARIS);
    expect(bounds).toHaveLength(8);
    expect(new Date(bounds[0]!).toISOString()).toBe("2026-11-22T23:00:00.000Z");
    expect(new Date(bounds[7]!).toISOString()).toBe("2026-11-29T23:00:00.000Z");
    expect(weekRangeWords(bounds, "en-GB", PARIS)).toMatch(/^23\s?–\s?29 Nov 2026$/);
  });

  it("moves by whole weeks, and a week with a clock change keeps seven days", () => {
    expect(new Date(weekBounds(NOW, 1, PARIS)[0]!).toISOString()).toBe("2026-11-29T23:00:00.000Z");
    // Clocks go forward in Paris on Sunday 28 March 2027.
    const spring = weekBounds(Date.parse("2027-03-24T12:00:00.000Z"), 0, PARIS);
    expect(new Date(spring[6]!).toISOString()).toBe("2027-03-27T23:00:00.000Z");
    expect(new Date(spring[7]!).toISOString()).toBe("2027-03-28T22:00:00.000Z");
  });

  it("puts a Sunday in the week that began the Monday before", () => {
    const sunday = Date.parse("2026-11-29T20:00:00.000Z");
    expect(new Date(weekBounds(sunday, 0, PARIS)[0]!).toISOString()).toBe(
      "2026-11-22T23:00:00.000Z",
    );
  });
});

describe("upcomingRunTimes", () => {
  const week = weekBounds(NOW, 0, PARIS);
  const range = { fromMs: week[0]!, untilMs: week[7]!, serverTimeZone: PARIS };

  it("lists a daily routine from its next run to the end of the week", () => {
    expect(iso(upcomingRunTimes(item("daily").task, range))).toEqual([
      "2026-11-27T07:00:00.000Z",
      "2026-11-28T07:00:00.000Z",
      "2026-11-29T07:00:00.000Z",
    ]);
  });

  it("keeps a weekday routine off the weekend", () => {
    const weekdays = item("weekdays", {
      schedule: { type: "fixed_time", timeOfDay: "08:00", weekdays: [1, 2, 3, 4, 5] },
    });
    expect(iso(upcomingRunTimes(weekdays.task, range))).toEqual(["2026-11-27T07:00:00.000Z"]);
    const next = weekBounds(NOW, 1, PARIS);
    expect(
      iso(upcomingRunTimes(weekdays.task, { ...range, fromMs: next[0]!, untilMs: next[7]! })),
    ).toEqual([
      "2026-11-30T07:00:00.000Z",
      "2026-12-01T07:00:00.000Z",
      "2026-12-02T07:00:00.000Z",
      "2026-12-03T07:00:00.000Z",
      "2026-12-04T07:00:00.000Z",
    ]);
  });

  it("shows a weekly routine once, in a week that is not the one its next run is in", () => {
    const weekly = item("weekly", {
      schedule: { type: "fixed_time", timeOfDay: "18:00", weekdays: [0] },
      nextRunAt: "2026-11-29T17:00:00.000Z",
    });
    const later = weekBounds(NOW, 2, PARIS);
    expect(
      iso(upcomingRunTimes(weekly.task, { ...range, fromMs: later[0]!, untilMs: later[7]! })),
    ).toEqual(["2026-12-13T17:00:00.000Z"]);
  });

  it("keeps the time of day on the server's clock across a clock change", () => {
    const spring = weekBounds(Date.parse("2027-03-24T12:00:00.000Z"), 0, PARIS);
    const daily = item("daily", { nextRunAt: "2027-03-27T07:00:00.000Z" });
    expect(
      iso(upcomingRunTimes(daily.task, { ...range, fromMs: spring[0]!, untilMs: spring[7]! })),
    ).toEqual(["2027-03-27T07:00:00.000Z", "2027-03-28T06:00:00.000Z"]);
  });

  it("steps an interval from its next run, and a reminder comes once", () => {
    const everySixHours = item("often", {
      schedule: { type: "interval", everyMs: 6 * 3_600_000 },
      nextRunAt: "2026-11-29T10:00:00.000Z",
    });
    expect(iso(upcomingRunTimes(everySixHours.task, range))).toEqual([
      "2026-11-29T10:00:00.000Z",
      "2026-11-29T16:00:00.000Z",
      "2026-11-29T22:00:00.000Z",
    ]);
    const reminder = item("call", {
      schedule: { type: "once", runAt: "2026-11-27T09:00:00+01:00" },
      nextRunAt: "2026-11-27T08:00:00.000Z",
    });
    expect(iso(upcomingRunTimes(reminder.task, range))).toEqual(["2026-11-27T08:00:00.000Z"]);
  });

  it("has nothing for a routine that is off", () => {
    expect(upcomingRunTimes(item("off", { enabled: false, nextRunAt: null }).task, range)).toEqual(
      [],
    );
  });
});

describe("buildWeek", () => {
  const bounds = weekBounds(NOW, 0, PARIS);
  const base = { bounds, nowMs: NOW, reminders: [], timeZone: PARIS };

  it("shows what ran, how it went, and what is still to come", () => {
    const morning = item("Start my day", {
      lastRunAt: "2026-11-26T07:00:02.000Z",
      lastRunStatus: "succeeded",
    });
    const days = buildWeek({
      ...base,
      routines: [morning],
      logged: [
        {
          itemKey: morning.key,
          run: { taskId: morning.task.id, at: "2026-11-24T07:00:01.000Z", status: "failed" },
        },
        {
          itemKey: morning.key,
          run: {
            taskId: morning.task.id,
            at: "2026-11-25T07:00:00.000Z",
            status: "failed",
            errorCode: "missed",
          },
        },
        // The log and the routine's own last run are the same run.
        {
          itemKey: morning.key,
          run: { taskId: morning.task.id, at: "2026-11-26T07:00:02.000Z", status: "running" },
        },
      ],
    });
    expect(days.map((day) => day.key)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(days.filter((day) => day.today).map((day) => day.key)).toEqual(["2026-11-26"]);
    expect(shown(days)).toEqual({
      "2026-11-24": ["08:00 Start my day failed"],
      "2026-11-25": ["08:00 Start my day skipped"],
      "2026-11-26": ["08:00 Start my day done"],
      "2026-11-27": ["08:00 Start my day upcoming"],
      "2026-11-28": ["08:00 Start my day upcoming"],
      "2026-11-29": ["08:00 Start my day upcoming"],
    });
  });

  it("shows reminders, the ones that went off too", () => {
    const call = item("Call the bank", {
      schedule: { type: "once", runAt: "2026-11-27T09:00:00+01:00" },
      nextRunAt: "2026-11-27T08:00:00.000Z",
    });
    const gone = item("Buy bread", {
      schedule: { type: "once", runAt: "2026-11-25T17:00:00+01:00" },
      nextRunAt: null,
      lastRunAt: "2026-11-25T16:00:00.000Z",
      lastRunStatus: "succeeded",
    });
    const days = buildWeek({ ...base, routines: [], reminders: [call], fired: [gone] });
    expect(shown(days)).toEqual({
      "2026-11-25": ["17:00 Buy bread done"],
      "2026-11-27": ["09:00 Call the bank upcoming"],
    });
    expect(days.flatMap((day) => day.runs).every((run) => run.reminder)).toBe(true);
  });

  it("promises no run while routines do not run, but a reminder still goes off", () => {
    const daily = item("daily");
    const call = item("call", {
      schedule: { type: "once", runAt: "2026-11-26T15:00:00+01:00" },
      nextRunAt: "2026-11-26T14:00:00.000Z",
    });
    const input = { ...base, routines: [daily], reminders: [call] };
    expect(shown(buildWeek({ ...input, hold: "nowhere" }))).toEqual({
      "2026-11-26": ["15:00 call upcoming"],
    });
    // Paused for today only: a run later today is left out.
    const tonight = item("tonight", {
      schedule: { type: "fixed_time", timeOfDay: "22:00" },
      nextRunAt: "2026-11-26T21:00:00.000Z",
    });
    expect(shown(buildWeek({ ...input, routines: [tonight], hold: "paused" }))).toEqual({
      "2026-11-26": ["15:00 call upcoming"],
      "2026-11-27": ["22:00 tonight upcoming"],
      "2026-11-28": ["22:00 tonight upcoming"],
      "2026-11-29": ["22:00 tonight upcoming"],
    });
  });

  it("gives a routine that runs all day one line a day", () => {
    const hourly = item("hourly", {
      schedule: { type: "interval", everyMs: 3_600_000 },
      nextRunAt: "2026-11-26T09:30:00.000Z",
    });
    const days = buildWeek({ ...base, routines: [hourly] });
    expect(shown(days)["2026-11-26"]).toEqual(["10:30 hourly upcoming x14"]);
    expect(shown(days)["2026-11-27"]).toEqual(["00:30 hourly upcoming x24"]);
  });

  it("leaves out a logged run whose routine is gone", () => {
    const days = buildWeek({
      ...base,
      routines: [],
      logged: [
        {
          itemKey: "env-mac:deleted",
          run: {
            taskId: ScheduledTaskId.make("deleted"),
            at: "2026-11-24T07:00:00.000Z",
            status: "succeeded",
          },
        },
      ],
    });
    expect(shown(days)).toEqual({});
  });
});
