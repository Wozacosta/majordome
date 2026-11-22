import { describe, expect, it } from "vite-plus/test";

import {
  assistantConversationActivity,
  assistantIntro,
  assistantScreenName,
  isAssistantConversationStale,
  screenContextRecord,
} from "./assistant.logic";

describe("assistantScreenName", () => {
  it.each([
    ["/", undefined, "Today"],
    ["/feed", undefined, "Feed"],
    ["/reminders", undefined, "Reminders"],
    ["/todos", undefined, "To-dos"],
    ["/reading", undefined, "Reading list"],
    ["/routines/", undefined, "Routines"],
    ["/notes", {}, "Notes"],
    ["/notes", { path: "people/Ada.md" }, 'Notes, reading the note "people/Ada.md"'],
    ["/settings/connectors", undefined, "Connections"],
    ["/settings/backup", undefined, "Settings, Back up my brain"],
    ["/settings/private-documents", undefined, "Settings, Private documents"],
    ["/settings/projects", undefined, "Settings, Notes folders"],
    ["/settings/storage", undefined, "Settings"],
    ["/env-1/thread-1", undefined, null],
    ["/draft/abc", undefined, null],
  ])("names %s %o", (pathname, search, expected) => {
    expect(assistantScreenName({ pathname, ...(search ? { search } : {}) })).toBe(expected);
  });
});

it("keeps the screen whole in the record when its label has to be cleaned", () => {
  expect(screenContextRecord('Notes, reading the note "lists/[todo].md"')).toMatchObject({
    kind: "screen",
    contextId: "screen",
    screen: 'Notes, reading the note "lists/[todo].md"',
    label: 'Notes, reading the note "lists/ todo .md"',
  });
});

describe("isAssistantConversationStale", () => {
  const now = Date.parse("2026-11-17T12:00:00.000Z");
  it.each([
    ["older than three days and idle", "2026-11-14T11:59:59.000Z", false, true],
    ["exactly three days old", "2026-11-14T12:00:00.000Z", false, false],
    ["recent", "2026-11-16T12:00:00.000Z", false, false],
    ["old but busy", "2026-11-01T12:00:00.000Z", true, false],
    ["never used", null, false, false],
    ["an unreadable time", "soon", false, false],
  ])("%s", (_name, lastActivityAt, busy, expected) => {
    expect(isAssistantConversationStale({ lastActivityAt, now, busy })).toBe(expected);
  });
});

describe("assistantConversationActivity", () => {
  type Shell = Parameters<typeof assistantConversationActivity>[0];
  const idle: Shell = {
    latestRun: null,
    runtime: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
  };

  it("has no activity until something is said", () => {
    expect(assistantConversationActivity(idle)).toEqual({ lastActivityAt: null, busy: false });
  });

  it("takes the latest of the last message and the last run", () => {
    const latestRun = {
      status: "completed",
      requestedAt: "2026-11-10T08:00:00.000Z",
      startedAt: "2026-11-10T08:00:01.000Z",
      completedAt: "2026-11-10T08:05:00.000Z",
    } as NonNullable<Shell["latestRun"]>;
    expect(
      assistantConversationActivity({
        ...idle,
        latestRun,
        latestUserMessageAt: "2026-11-10T08:00:00.000Z",
      }),
    ).toEqual({ lastActivityAt: "2026-11-10T08:05:00.000Z", busy: false });
  });

  it("is busy during a run or while something waits on the person", () => {
    const runtime = { status: "running" } as NonNullable<Shell["runtime"]>;
    expect(assistantConversationActivity({ ...idle, runtime }).busy).toBe(true);
    expect(assistantConversationActivity({ ...idle, hasPendingApprovals: true }).busy).toBe(true);
    expect(assistantConversationActivity({ ...idle, hasPendingUserInput: true }).busy).toBe(true);
  });
});

it("says in one short line what the assistant can be asked about on this page", () => {
  const intro = (pathname: string, search?: Record<string, unknown>) =>
    assistantIntro({ pathname, ...(search === undefined ? {} : { search }) });
  expect(intro("/settings/private-documents")).toBe(
    "Ask about Private documents, or say what to change.",
  );
  expect(intro("/routines/")).toBe("Ask about Routines, or say what to change.");
  expect(intro("/notes", { path: "projects/a.md" })).toBe(
    "Ask about this note, or say what to change.",
  );
  expect(intro("/notes")).toBe("Ask about your notes, or say what to change.");
  expect(intro("/somewhere-else")).toBe("Ask anything, or say what to change.");
});
