import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  type ScheduledTask,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  routineKind,
  routineLastRun,
  routineScheduleWords,
  routinesHold,
  routineThreadKeys,
  routineTopicIds,
  routineWhenLine,
  selectRoutines,
  sinceWords,
  untilWords,
} from "./routines.logic";

const NOW = Date.parse("2026-11-16T09:00:00.000Z");
const mac = EnvironmentId.make("env-mac");
const server = EnvironmentId.make("env-server");
const notes = ProjectId.make("notes");

const task = (id: string, overrides: Partial<ScheduledTask> = {}) =>
  ({
    id: ScheduledTaskId.make(id),
    title: id,
    projectId: notes,
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "08:00" },
    nextRunAt: "2026-11-17T08:00:00.000Z",
    threadId: null,
    ...overrides,
  }) as ScheduledTask;

const once = (id: string, runAt: string, overrides: Partial<ScheduledTask> = {}) =>
  task(id, { schedule: { type: "once", runAt }, nextRunAt: runAt, ...overrides });

describe("routineKind", () => {
  it.each([
    ["a repeating task is a routine", task("daily"), "routine"],
    ["even while it is off", task("off", { enabled: false, nextRunAt: null }), "routine"],
    [
      "a one-time task still to come is a reminder",
      once("r", "2026-11-17T10:00:00.000Z"),
      "reminder",
    ],
    ["one that fired is done", once("r", "2026-11-15T10:00:00.000Z", { nextRunAt: null }), "done"],
    [
      "one that was turned off is done",
      once("r", "2026-11-17T10:00:00.000Z", { enabled: false, nextRunAt: null }),
      "done",
    ],
    [
      "a task another service calls runs from outside",
      task("hook", { schedule: { type: "webhook", signature: null }, nextRunAt: null }),
      "outside",
    ],
  ] as const)("%s", (_name, input, kind) => {
    expect(routineKind(input)).toBe(kind);
  });
});

describe("selectRoutines", () => {
  it("takes routines from the server that runs them and reminders from every server", () => {
    const { routines, reminders } = selectRoutines({
      copies: [
        {
          environmentId: mac,
          projectId: notes,
          tasks: [
            task("start-my-day"),
            once("call-the-bank", "2026-11-18T10:00:00.000Z"),
            once("already-rang", "2026-11-15T10:00:00.000Z", { nextRunAt: null }),
            task("other-folder", { projectId: ProjectId.make("code") }),
          ],
        },
        {
          environmentId: server,
          projectId: notes,
          timeZone: "Europe/Lisbon",
          tasks: [
            task("start-my-day"),
            task("hook", { schedule: { type: "webhook", signature: null }, nextRunAt: null }),
            once("water-the-plants", "2026-11-17T10:00:00.000Z"),
          ],
        },
      ],
      runner: { environmentId: server, projectId: notes },
    });
    expect(routines.map((item) => item.key)).toEqual([
      "env-server:start-my-day",
      "env-server:hook",
    ]);
    expect(routines[0]?.timeZone).toBe("Europe/Lisbon");
    expect(reminders.map((item) => item.key)).toEqual([
      "env-server:water-the-plants",
      "env-mac:call-the-bank",
    ]);
  });

  it("shows nothing from a server that has not answered yet", () => {
    expect(
      selectRoutines({
        copies: [{ environmentId: mac, projectId: notes, tasks: null }],
        runner: { environmentId: mac, projectId: notes },
      }),
    ).toEqual({ routines: [], reminders: [], fired: [] });
  });
});

describe("routineScheduleWords", () => {
  const words = (schedule: ScheduledTask["schedule"], serverTimeZone?: string) =>
    routineScheduleWords(schedule, {
      serverTimeZone,
      readerTimeZone: "Europe/Lisbon",
      locale: "en-GB",
    });

  it.each([
    [{ type: "fixed_time", timeOfDay: "08:00" }, "Every day at 8:00"],
    [{ type: "fixed_time", timeOfDay: "18:00", weekdays: [0] }, "Sundays at 18:00"],
    [{ type: "fixed_time", timeOfDay: "07:30", weekdays: [5, 4, 3, 2, 1] }, "Weekdays at 7:30"],
    [
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 4] },
      "Mondays, Thursdays and Sundays at 9:00",
    ],
    [{ type: "interval", everyMs: 30 * 60_000 }, "Every 30 minutes"],
    [{ type: "interval", everyMs: 60 * 60_000 }, "Every hour"],
    [{ type: "interval", everyMs: 2 * 60 * 60_000 }, "Every 2 hours"],
    [{ type: "interval", everyMs: 24 * 60 * 60_000 }, "Every day"],
    [{ type: "once", runAt: "2026-11-17T10:00:00+00:00" }, "Once, Tue 17 Nov, 10:00"],
    [{ type: "webhook", signature: null }, "When something arrives"],
  ] as const)("%j reads as %s", (schedule, expected) => {
    expect(words(schedule)).toBe(expected);
  });

  it("names the server's zone only when the reader is somewhere else", () => {
    const schedule = { type: "fixed_time", timeOfDay: "08:00" } as const;
    expect(words(schedule, "Europe/Lisbon")).toBe("Every day at 8:00");
    expect(words(schedule, "UTC")).toBe("Every day at 8:00 (UTC)");
  });
});

describe("routineWhenLine", () => {
  it("says when it runs next, that it is off, or why it cannot run", () => {
    const options = { readerTimeZone: "Europe/Lisbon", locale: "en-GB" };
    expect(
      routineWhenLine(task("a", { nextRunAt: "2026-11-16T12:00:00.000Z" }), NOW, options),
    ).toBe("Every day at 8:00 · Next in 3 hours");
    expect(routineWhenLine(task("a", { enabled: false, nextRunAt: null }), NOW, options)).toBe(
      "Every day at 8:00 · Off",
    );
    expect(
      routineWhenLine(
        task("a", { schedule: { type: "webhook", signature: null }, nextRunAt: null }),
        NOW,
        options,
      ),
    ).toBe("When something arrives");
    expect(routineWhenLine(task("a", { blockedByPolicy: "Not allowed here." }), NOW, options)).toBe(
      "Every day at 8:00 · Not allowed here.",
    );
  });
});

describe("untilWords", () => {
  it.each([
    ["2026-11-16T08:59:00.000Z", "any moment now"],
    ["2026-11-16T09:01:00.000Z", "in 1 minute"],
    ["2026-11-16T09:20:00.000Z", "in 20 minutes"],
    ["2026-11-16T10:00:00.000Z", "in 1 hour"],
    ["2026-11-17T08:00:00.000Z", "in 23 hours"],
    ["2026-11-18T10:00:00.000Z", "in 2 days"],
  ])("%s is %s", (at, expected) => {
    expect(untilWords(at, NOW)).toBe(expected);
  });
});

describe("a routine's chats", () => {
  const kept = ThreadId.make("kept");
  const finances = ThreadId.make("finances");
  const item = (id: string, threadId: ThreadId | null) => ({
    key: `${server}:${id}`,
    environmentId: server,
    task: task(id, { threadId }),
    timeZone: undefined,
  });
  const routines = [item("Start my day", kept), item("Review my money", finances)];

  it("are the one it keeps and the per-run chats it opened before, never the owner's own", () => {
    const thread = (id: string, title: string, createdBy: string, environmentId = server) => ({
      environmentId,
      id: ThreadId.make(id),
      projectId: notes,
      title,
      source: { createdBy },
    });
    const keys = routineThreadKeys(routines, [
      thread("kept", "Start my day", "system"),
      thread("old-run", "Start my day", "system"),
      thread("mine", "Start my day", "user"),
      thread("other-server", "Start my day", "system", mac),
      thread("chat", "Trip to Lisbon", "user"),
    ]);
    expect([...keys].toSorted()).toEqual(
      [
        ...[kept, finances, ThreadId.make("old-run")].map((threadId) =>
          scopedThreadKey({ environmentId: server, threadId }),
        ),
        scopedThreadKey({ environmentId: mac, threadId: ThreadId.make("other-server") }),
      ].toSorted(),
    );
  });

  it("belong to the topic whose conversation on the routine's server they post in", () => {
    const topics = [{ id: "finances", threadId: finances }];
    expect([
      ...routineTopicIds(routines, [
        { environmentId: mac, topics },
        { environmentId: server, topics: [...topics, { id: "unopened", threadId: null }] },
      ]),
    ]).toEqual([[`${server}:Review my money`, "finances"]]);
    expect(routineTopicIds(routines, [{ environmentId: mac, topics }]).size).toBe(0);
  });
});

describe("routinesHold", () => {
  const status = (reason: "no-provider" | "not-created") => ({ ready: false, reason });
  it.each([
    ["nothing is known while the history loads", null, null],
    ["routines that run are not held", { routinesRunner: "this-server" }, null],
    ["no computer runs them", { routinesRunner: "none", pausedToday: true }, "nowhere"],
    [
      "the AI they use is signed out",
      { routinesRunner: "this-server", routinesStatus: status("no-provider"), pausedToday: true },
      "blocked",
    ],
    [
      "routines still being set up are not held",
      { routinesRunner: "this-server", routinesStatus: status("not-created") },
      null,
    ],
    ["today's runs are used up", { routinesRunner: "another-server", pausedToday: true }, "paused"],
  ] as const)("%s", (_name, history, hold) => {
    expect(routinesHold(history)).toBe(hold);
  });
});

describe("routineWhenLine while routines are held", () => {
  it.each([
    ["paused", "Every day at 8:00 AM · Paused until tomorrow"],
    ["nowhere", "Every day at 8:00 AM · Not running"],
    ["blocked", "Every day at 8:00 AM · Not running"],
  ] as const)("does not promise a next run when %s", (hold, line) => {
    expect(routineWhenLine(task("daily"), NOW, { hold })).toBe(line);
  });

  it("still says a routine is off", () => {
    expect(routineWhenLine(task("off", { enabled: false }), NOW, { hold: "paused" })).toBe(
      "Every day at 8:00 AM · Off",
    );
  });
});

describe("sinceWords", () => {
  it.each([
    ["2026-11-16T08:00:00.000Z", "today 8:00 AM"],
    ["2026-11-15T23:30:00.000Z", "yesterday 11:30 PM"],
    ["2026-11-13T08:00:00.000Z", "Fri, Nov 13, 8:00 AM"],
  ])("%s reads %s", (iso, words) => {
    expect(sinceWords(iso, NOW, "en-US", "UTC")).toBe(words);
  });

  it("counts days in the reader's zone", () => {
    expect(sinceWords("2026-11-15T23:30:00.000Z", NOW, "en-US", "Europe/Paris")).toBe(
      "today 12:30 AM",
    );
  });
});

describe("routineLastRun", () => {
  const zones = { locale: "en-US", readerTimeZone: "UTC", serverTimeZone: "UTC" };
  const ran = (overrides: Partial<ScheduledTask>) =>
    task("daily", {
      lastRunAt: "2026-11-15T08:00:00.000Z",
      lastRunStatus: "failed",
      lastRunError: null,
      ...overrides,
    });

  it("says nothing before the first run", () => {
    expect(routineLastRun(ran({ lastRunAt: null, lastRunStatus: "never" }), NOW, zones)).toBeNull();
  });

  it("says when a good run was", () => {
    expect(routineLastRun(ran({ lastRunStatus: "succeeded" }), NOW, zones)).toEqual({
      tone: "ok",
      text: "Last run went well · yesterday 8:00 AM",
    });
  });

  it("names the run a sleeping computer skipped, not the earlier one that ran", () => {
    expect(
      routineLastRun(
        ran({
          lastRunAt: "2026-11-13T08:00:00.000Z",
          lastRunError: "Missed a scheduled run because the server was not running at that time.",
          lastRunErrorCode: "missed",
        }),
        NOW,
        zones,
      ),
    ).toEqual({
      tone: "warning",
      text: "Skipped on Mon at 8:00 AM: the computer was asleep or off",
      remedy: "run-now",
    });
  });

  it("looks back to the last day the routine runs on", () => {
    const fridays = ran({
      schedule: { type: "fixed_time", timeOfDay: "18:00", weekdays: [5] },
      nextRunAt: "2026-11-20T18:00:00.000Z",
      lastRunErrorCode: "missed",
    });
    expect(routineLastRun(fridays, NOW, zones)?.text).toBe(
      "Skipped on Fri at 6:00 PM: the computer was asleep or off",
    );
  });

  it("takes the skipped day from the server's zone", () => {
    const late = ran({
      schedule: { type: "fixed_time", timeOfDay: "23:00" },
      nextRunAt: "2026-11-17T04:00:00.000Z",
      lastRunErrorCode: "missed",
    });
    expect(routineLastRun(late, NOW, { ...zones, serverTimeZone: "America/New_York" })?.text).toBe(
      "Skipped on Sun at 11:00 PM: the computer was asleep or off",
    );
  });

  it("points to the chat when an earlier run is still waiting there", () => {
    expect(routineLastRun(ran({ lastRunErrorCode: "held" }), NOW, zones)).toEqual({
      tone: "warning",
      text: "Skipped a run: an earlier one is still waiting in its chat",
      remedy: "open-chat",
    });
  });

  it("does not call a run the owner stopped a failure", () => {
    expect(routineLastRun(ran({ lastRunErrorCode: "stopped" }), NOW, zones)).toEqual({
      tone: "neutral",
      text: "Last run was stopped · yesterday 8:00 AM",
    });
  });

  it("keeps an unknown cause as details, out of the line", () => {
    expect(
      routineLastRun(
        ran({ lastRunError: "spawn ENOENT", lastRunErrorCode: "new-code" }),
        NOW,
        zones,
      ),
    ).toEqual({
      tone: "error",
      text: "Last run couldn't finish · yesterday 8:00 AM",
      details: "spawn ENOENT",
    });
  });
});
