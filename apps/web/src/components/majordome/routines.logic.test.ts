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
  routineScheduleWords,
  routineThreadKeys,
  routineTopicIds,
  routineWhenLine,
  selectRoutines,
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
    ).toEqual({ routines: [], reminders: [] });
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
    [{ type: "webhook", signature: null }, "Runs when called from outside"],
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
    ).toBe("Runs when called from outside");
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
