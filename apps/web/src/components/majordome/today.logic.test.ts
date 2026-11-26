import { EnvironmentId, type MajordomeVaultHistoryEntry, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFeedItems, feedVaultNotes } from "./feed.logic";
import {
  assistantNotSetUp,
  dayKey,
  greetingForHour,
  openTasks,
  pickTodayStarter,
  selectTodayRuns,
  shiftDay,
  timeOfDay,
  TODAY_STARTERS,
  weekOf,
} from "./today.logic";

const vault = {
  environmentId: EnvironmentId.make("env-1"),
  projectId: ProjectId.make("notes"),
  title: "Notes",
};

const entry = (
  overrides: Partial<MajordomeVaultHistoryEntry> & Pick<MajordomeVaultHistoryEntry, "commit">,
): MajordomeVaultHistoryEntry => ({
  subject: "majordome: Start my day",
  body: "",
  authorName: "Majordome",
  committedAt: "2026-11-15T08:00:00Z",
  byMajordome: true,
  threadId: null,
  files: [],
  ...overrides,
});

const select = (
  entries: ReadonlyArray<MajordomeVaultHistoryEntry>,
  options: Partial<Parameters<typeof selectTodayRuns>[0]> = {},
) =>
  selectTodayRuns({
    changes: buildFeedItems([{ vault, entries }], { includeOwnChanges: true }),
    notesOf: () => feedVaultNotes({}),
    ...options,
  });

describe("daily note days", () => {
  it("names a day on the device's calendar and steps across months and years", () => {
    const lateEvening = new Date(2026, 10, 19, 23, 5);
    expect([dayKey(lateEvening), timeOfDay(lateEvening)]).toEqual(["2026-11-19", "23:05"]);
    expect([
      shiftDay("2026-03-01", -1),
      shiftDay("2026-12-31", 1),
      shiftDay("2026-11-19", 0),
    ]).toEqual(["2026-02-28", "2027-01-01", "2026-11-19"]);
  });
});

describe("weekOf", () => {
  it("runs Monday to Sunday around the day, a Sunday included", () => {
    expect(weekOf("2026-11-19")).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(weekOf("2026-11-22")[0]).toBe("2026-11-16");
  });
});

describe("openTasks", () => {
  it("lists unticked boxes with where they sit, skipping ticked ones and code", () => {
    const note =
      "# Day\n- [ ] **Call** the bank\n- [x] Done\n```\n- [ ] not a task\n```\n  * [ ] Nested";
    const tasks = openTasks(note);
    expect(tasks.map((task) => task.text)).toEqual(["**Call** the bank", "Nested"]);
    expect(tasks.map((task) => note.slice(task.markerOffset, task.markerOffset + 3))).toEqual([
      "[ ]",
      "[ ]",
    ]);
  });
});

describe("greetingForHour", () => {
  it("follows the day, with the small hours as the evening", () => {
    expect([0, 4, 5, 11, 12, 17, 18, 23].map(greetingForHour)).toEqual([
      "Good evening",
      "Good evening",
      "Good morning",
      "Good morning",
      "Good afternoon",
      "Good afternoon",
      "Good evening",
      "Good evening",
    ]);
  });
});

describe("selectTodayRuns", () => {
  it("keeps Majordome's latest runs, newest first, with their summaries", () => {
    const runs = select([
      entry({ commit: "a", threadId: "t-a", summary: "Wrote your day.", routine: "start-my-day" }),
      entry({
        commit: "b",
        subject: "majordome: Review my week",
        committedAt: "2026-11-16T08:00:00Z",
        threadId: "t-b",
        summary: "Your week in five lines.",
      }),
      entry({ commit: "mine", subject: "Your edits", byMajordome: false }),
      entry({ commit: "undo", subject: "Undo: majordome: Wrong guess", body: "Reverts c0ffee1." }),
      entry({ commit: "c0ffee1", subject: "majordome: Wrong guess", threadId: "t-c" }),
    ]);
    expect(runs.map((run) => [run.title, run.threadId, run.summary])).toEqual([
      ["Review my week", "t-b", "Your week in five lines."],
      ["Start my day", "t-a", "Wrote your day."],
    ]);
  });

  it("shows at most four, and one row per chat", () => {
    const runs = select(
      ["01", "02", "03", "04", "05", "06"].map((day) =>
        entry({
          commit: day,
          committedAt: `2026-11-${day}T08:00:00Z`,
          threadId: day === "06" ? "t-05" : `t-${day}`,
        }),
      ),
    );
    expect(runs.map((run) => run.key)).toEqual([
      "change:env-1:notes:06",
      "change:env-1:notes:04",
      "change:env-1:notes:03",
      "change:env-1:notes:02",
    ]);
  });

  it("leaves a topic's conversation to the topics list", () => {
    const runs = select([entry({ commit: "a", threadId: "t-topic" })], {
      topicThreads: new Set(["env-1:t-topic"]),
    });
    expect(runs).toEqual([]);
  });
});

describe("assistantNotSetUp", () => {
  const account = {
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
  } as const;

  it("is true only once the accounts are known and none can answer", () => {
    expect(assistantNotSetUp(undefined)).toBe(false);
    expect(assistantNotSetUp([])).toBe(true);
    expect(assistantNotSetUp([account])).toBe(false);
    expect(assistantNotSetUp([{ ...account, status: "warning" }])).toBe(false);
    expect(assistantNotSetUp([{ ...account, installed: false }])).toBe(true);
    expect(assistantNotSetUp([{ ...account, auth: { status: "unauthenticated" } }])).toBe(true);
    expect(
      assistantNotSetUp([{ ...account, status: "error" }, { ...account, enabled: false }, account]),
    ).toBe(false);
  });
});

describe("pickTodayStarter", () => {
  const [remember, , remind, plan] = TODAY_STARTERS;

  it("sends a whole request at once and leaves the start of a sentence to be finished", () => {
    expect(pickTodayStarter("", plan)).toEqual({ text: "Help me plan my day.", send: true });
    expect(pickTodayStarter("  ", remind)).toEqual({ text: "Remind me to ", send: false });
    // Another starter, still as it was put in, is replaced.
    expect(pickTodayStarter("Remember that ", plan)).toEqual({
      text: "Help me plan my day.",
      send: true,
    });
    expect(pickTodayStarter("Help me plan my day.", remember)).toEqual({
      text: "Remember that ",
      send: false,
    });
  });

  it("keeps what the owner typed, after the starter, and never sends it for them", () => {
    expect(pickTodayStarter("call the dentist", remind)).toEqual({
      text: "Remind me to call the dentist",
      send: false,
    });
    expect(pickTodayStarter("I have three meetings", plan)).toEqual({
      text: "Help me plan my day. I have three meetings",
      send: false,
    });
  });
});
