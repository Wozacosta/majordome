import {
  EnvironmentId,
  type MajordomeVaultHistoryEntry,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFeedItems, type FeedRunItem, feedVaultNotes } from "./feed.logic";
import { greetingForHour, selectTodayRuns } from "./today.logic";

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

const attention = (
  threadId: string,
  status: FeedRunItem["status"],
  at: string,
  title = threadId,
): FeedRunItem => ({
  ownerCardId: null,
  key: `env-1:${threadId}`,
  vault,
  threadId: ThreadId.make(threadId),
  title,
  status,
  at,
});

const select = (
  entries: ReadonlyArray<MajordomeVaultHistoryEntry>,
  options: Partial<Parameters<typeof selectTodayRuns>[0]> = {},
) =>
  selectTodayRuns({
    attention: [],
    changes: buildFeedItems([{ vault, entries }], { includeOwnChanges: true }),
    notesOf: () => feedVaultNotes({}),
    ...options,
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
    expect(runs.map((run) => [run.title, run.threadId, run.summary, run.status])).toEqual([
      ["Review my week", "t-b", "Your week in five lines.", null],
      ["Start my day", "t-a", "Wrote your day.", null],
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

  it("puts runs that need the owner first, in place of what those chats saved", () => {
    const runs = select(
      [
        entry({ commit: "a", committedAt: "2026-11-16T09:00:00Z", threadId: "t-a" }),
        entry({ commit: "b", committedAt: "2026-11-16T07:00:00Z", threadId: "t-failed" }),
      ],
      {
        attention: [
          attention("t-failed", "failed", "2026-11-14T08:00:00Z", "Digest my inbox"),
          attention("t-waiting", "waiting", "2026-11-15T08:00:00Z", "Plan the trip"),
        ],
      },
    );
    expect(runs.map((run) => [run.title, run.status])).toEqual([
      ["Plan the trip", "waiting"],
      ["Digest my inbox", "failed"],
      ["Start my day", null],
    ]);
  });

  it("leaves a topic's conversation to the topics list", () => {
    const runs = select([entry({ commit: "a", threadId: "t-topic" })], {
      attention: [attention("t-topic", "waiting", "2026-11-15T08:00:00Z")],
      topicThreads: new Set(["env-1:t-topic"]),
    });
    expect(runs).toEqual([]);
  });
});
