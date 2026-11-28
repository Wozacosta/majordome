import { expect, it } from "vite-plus/test";

import {
  gatherRoutineChats,
  routineChats,
  routineHeadline,
  routineRows,
  routinesForDay,
  routineStatus,
  withRoutineHidden,
  type RoutineRow,
} from "./routine.logic";

it("knows a routine's chats: the one it keeps and the earlier runs that carry its name", () => {
  const found = routineChats(
    [
      { title: "Tidy my memory", threadId: "kept", schedule: { type: "cron" } },
      { title: "Call mum", threadId: "once", schedule: { type: "once" } },
    ],
    [
      { id: "kept", title: "Renamed since", createdBy: "agent" },
      { id: "old-run", title: "Tidy my memory", createdBy: "agent" },
      // The owner's own chat that happens to share the name, and a reminder's chat.
      { id: "mine", title: "Tidy my memory", createdBy: "user" },
      { id: "once", title: "Call mum", createdBy: "agent" },
    ],
  );
  expect([...found]).toEqual([
    ["kept", "Tidy my memory"],
    ["old-run", "Tidy my memory"],
  ]);
});

it("gathers each routine's chats under its latest run and leaves out hidden routines", () => {
  const routineOf = new Map([
    ["tidy-3", "Tidy"],
    ["tidy-2", "Tidy"],
    ["tidy-1", "Tidy"],
    ["day-1", "Start my day"],
  ]);
  const idOf = (item: string) => (item === "label" ? null : item);
  const gathered = gatherRoutineChats(
    ["tidy-3", "chat", "day-1", "label", "tidy-2", "tidy-1"],
    idOf,
    routineOf,
    new Set(["Start my day"]),
  );
  expect(gathered.items).toEqual(["tidy-3", "chat", "label", "tidy-2", "tidy-1"]);
  expect([...gathered.byThread]).toEqual([
    ["tidy-3", { id: "routine:Tidy", title: "Tidy", sideThreadIds: ["tidy-2", "tidy-1"] }],
  ]);
});

const at = (hour: number, minute = 0, day = 28) =>
  new Date(2026, 10, day, hour, minute).toISOString();

const routine = (over: Partial<RoutineRow> & { readonly title: string }): RoutineRow => ({
  id: over.title,
  threadId: null,
  enabled: true,
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  ...over,
});

it("lists the routines among the scheduled tasks, without the one-time reminders", () => {
  const task = {
    id: "a",
    title: "Start my day",
    threadId: "t1",
    enabled: true,
    schedule: { type: "fixed_time" },
    nextRunAt: at(8, 0, 29),
    lastRunAt: at(8),
    lastRunStatus: "failed",
    lastRunErrorCode: "missed",
  };
  expect(routineRows([task, { ...task, id: "b", schedule: { type: "once" } }])).toEqual([
    {
      id: "a",
      title: "Start my day",
      threadId: "t1",
      enabled: true,
      nextRunAt: at(8, 0, 29),
      lastRunAt: at(8),
      lastRunStatus: "failed",
      missed: true,
    },
  ]);
});

it("says how a routine's run went on the day shown", () => {
  const ran = routine({ title: "Start my day", lastRunAt: at(8), lastRunStatus: "succeeded" });
  expect(routineStatus(ran, "2026-11-28", "2026-11-28")).toEqual({
    text: "Done 08:00",
    tone: "quiet",
  });
  expect(
    routineStatus(
      { ...ran, lastRunAt: at(11, 20), lastRunStatus: "failed" },
      "2026-11-28",
      "2026-11-28",
    ),
  ).toEqual({ text: "Failed 11:20", tone: "warning" });
  expect(
    routineStatus({ ...ran, lastRunStatus: "failed", missed: true }, "2026-11-28", "2026-11-28"),
  ).toEqual({ text: "Missed 08:00", tone: "warning" });
  expect(
    routineStatus({ ...ran, lastRunStatus: "running" }, "2026-11-28", "2026-11-28")?.text,
  ).toBe("Running");
});

it("says when a routine runs next when it did not run on the day shown", () => {
  const next = (nextRunAt: string) =>
    routineStatus(
      routine({ title: "Review", nextRunAt, lastRunAt: at(18, 0, 22), lastRunStatus: "succeeded" }),
      "2026-11-28",
      "2026-11-28",
    )?.text;
  expect(next(at(18))).toBe("Today 18:00");
  expect(next(at(8, 0, 29))).toBe("Tomorrow 08:00");
  // 28 November 2026 is a Saturday.
  expect(next(at(18, 0, 30))).toBe("Mon 18:00");
  expect(next(at(9, 5, 36))).toBe("6 Dec 09:05");
  expect(
    routineStatus(
      routine({ title: "Off", enabled: false, nextRunAt: at(18) }),
      "2026-11-28",
      "2026-11-28",
    )?.text,
  ).toBe("Paused");
  expect(routineStatus(routine({ title: "On demand" }), "2026-11-28", "2026-11-28")).toBeNull();
});

it("lists every routine today, and on another day only those that ran or will run then", () => {
  const day = routine({
    title: "Start my day",
    lastRunAt: at(8, 0, 27),
    lastRunStatus: "succeeded",
  });
  const week = routine({ title: "Review my week", nextRunAt: at(18, 0, 29) });
  const inbox = routine({ title: "Digest my inbox", lastRunAt: at(11), lastRunStatus: "failed" });
  const all = [day, week, inbox];
  const names = (rows: ReadonlyArray<RoutineRow>) => rows.map((row) => row.title);
  const today = routinesForDay(all, "2026-11-28", "2026-11-28", ["Digest my inbox"]);
  expect(names(today.shown)).toEqual(["Start my day", "Review my week"]);
  expect(names(today.hidden)).toEqual(["Digest my inbox"]);
  expect(names(routinesForDay(all, "2026-11-27", "2026-11-28", []).shown)).toEqual([
    "Start my day",
  ]);
  expect(names(routinesForDay(all, "2026-11-29", "2026-11-28", []).shown)).toEqual([
    "Review my week",
  ]);
  expect(routinesForDay(all, "2026-11-20", "2026-11-28", []).shown).toEqual([]);
});

it("hides a routine once and shows it again", () => {
  expect(withRoutineHidden(["Tidy"], "Tidy", true)).toEqual(["Tidy"]);
  expect(withRoutineHidden(["Tidy"], "Start my day", true)).toEqual(["Tidy", "Start my day"]);
  expect(withRoutineHidden(["Tidy", "Start my day"], "Tidy", false)).toEqual(["Start my day"]);
});

it("picks today's latest run for the home page, else the next one due today", () => {
  const brief = routine({ title: "Morning brief", lastRunAt: at(8), lastRunStatus: "succeeded" });
  const inbox = routine({
    title: "Digest my inbox",
    lastRunAt: at(11, 20),
    lastRunStatus: "failed",
  });
  const review = routine({ title: "Review my week", nextRunAt: at(18) });
  const later = routine({ title: "Tidy", nextRunAt: at(21) });
  expect(routineHeadline([brief, inbox, review], "2026-11-28", [])).toBe("Digest my inbox failed");
  expect(routineHeadline([brief, inbox, review], "2026-11-28", ["Digest my inbox"])).toBe(
    "Morning brief done",
  );
  expect(routineHeadline([later, review], "2026-11-28", [])).toBe("Review my week at 18:00");
  // Yesterday's run and tomorrow's are not today's news.
  expect(
    routineHeadline(
      [
        routine({
          title: "Old",
          lastRunAt: at(8, 0, 27),
          lastRunStatus: "succeeded",
          nextRunAt: at(8, 0, 29),
        }),
      ],
      "2026-11-28",
      [],
    ),
  ).toBeNull();
});
