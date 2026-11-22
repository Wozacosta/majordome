import {
  EnvironmentId,
  type MajordomeTodoNote,
  ProjectId,
  type ScheduledTask,
  ScheduledTaskId,
  type ServerProviderUsageWindow,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { todoKey } from "./todos.logic";
import {
  allNotesLabel,
  lowUsageLine,
  topicNoteLabel,
  topicPanelChats,
  topicPanelNotes,
  topicPanelRoutines,
  topicPanelTodos,
  topicTabs,
} from "./TopicPanel.logic";
import type { VaultTopic } from "./topics.logic";

// A Monday, 09:00 in Paris.
const NOW = Date.parse("2026-11-16T08:00:00.000Z");
const reader = { locale: "en-GB", timeZone: "Europe/Paris" };
const mac = EnvironmentId.make("mac");
const server = EnvironmentId.make("server");
const chat = ThreadId.make("house-chat");

const usageWindow = (
  usedPercent: number,
  overrides: Partial<ServerProviderUsageWindow> = {},
): ServerProviderUsageWindow => ({
  id: `w-${usedPercent}`,
  kind: "weekly",
  label: "Weekly",
  usedPercent,
  ...overrides,
});

const topic = (overrides: Partial<VaultTopic> = {}): VaultTopic => ({
  id: "house",
  title: "House",
  folder: "projects/house",
  threadId: chat,
  threadEnvironmentId: mac,
  folderExists: true,
  keyNote: "projects/house/log.md",
  ...overrides,
});

describe("lowUsageLine", () => {
  it.each([
    ["nothing while every window has room", [usageWindow(32), usageWindow(79)], null],
    ["nothing without windows", [], null],
    [
      "a warning at a fifth left, with the day it resets",
      [usageWindow(80, { resetsAt: "2026-11-19T10:00:00.000Z" })],
      {
        tone: "warning",
        text: "You're running low on your AI plan this week. It resets Thursday.",
      },
    ],
    [
      "an error at a tenth left, for the lowest window",
      [usageWindow(85), usageWindow(92, { kind: "session", resetsAt: "2026-11-16T14:00:00.000Z" })],
      {
        tone: "error",
        text: "You're running low on your AI plan for now. It resets today at 15:00.",
      },
    ],
    [
      "used up, resetting tomorrow",
      [usageWindow(100, { resetsAt: "2026-11-16T23:30:00.000Z" })],
      { tone: "error", text: "You've used up your AI plan this week. It resets tomorrow." },
    ],
    [
      "a month away",
      [usageWindow(90, { kind: "monthly", resetsAt: "2026-12-01T10:00:00.000Z" })],
      {
        tone: "error",
        text: "You're running low on your AI plan this month. It resets on 1 December.",
      },
    ],
    [
      "no reset known",
      [usageWindow(81, { kind: "other" })],
      { tone: "warning", text: "You're running low on your AI plan." },
    ],
    [
      "a window whose reset has passed says nothing about now",
      [usageWindow(99, { resetsAt: "2026-11-16T07:00:00.000Z" }), usageWindow(10)],
      null,
    ],
  ])("%s", (_name, windows, expected) => {
    expect(lowUsageLine(windows, NOW, reader)).toEqual(expected);
  });
});

describe("topic panel notes", () => {
  const file = (path: string) => ({ path, kind: "file" });

  it("lists the key note first, then the folder's notes nearest the top, by name", () => {
    const notes = topicPanelNotes(topic(), [
      file("projects/house/quotes/roof.md"),
      file("projects/house/plumber.md"),
      file("projects/house/log.md"),
      file("projects/house/README.md"),
      file("projects/house/bill.pdf"),
      file("projects/house/.obsidian/x.md"),
      file("projects/housework.md"),
      { path: "projects/house/quotes", kind: "directory" },
      file("projects/house/budget_2026.md"),
      file("projects/house/zebra.md"),
      file("projects/house/quotes/attic.md"),
    ]);
    expect(notes.map((note) => [note.label, note.isKeyNote])).toEqual([
      ["Running log", true],
      ["budget 2026", false],
      ["Overview", false],
      ["plumber", false],
      ["zebra", false],
    ]);
    expect(notes[1]?.path).toBe("projects/house/budget_2026.md");
  });

  it("shows the key note before the folder is listed, and nothing for an empty folder", () => {
    expect(topicPanelNotes(topic(), []).map((note) => note.path)).toEqual([
      "projects/house/log.md",
    ]);
    expect(topicPanelNotes(topic({ keyNote: null }), [])).toEqual([]);
  });

  it("names notes as the owner reads them", () => {
    expect(topicNoteLabel("projects/house/LOG.md")).toBe("Running log");
    expect(topicNoteLabel("index.md")).toBe("Overview");
    expect(topicNoteLabel("a/roof-quotes.v2.md")).toBe("roof quotes.v2");
    expect(allNotesLabel(undefined)).toBe("All notes");
    expect(allNotesLabel(12)).toBe("All notes (12)");
  });
});

describe("topic panel to-dos", () => {
  const note = (path: string, texts: ReadonlyArray<string>, more = 0): MajordomeTodoNote => ({
    path,
    title: path,
    modifiedAt: "2026-11-16T08:00:00.000Z",
    todos: texts.map((text, index) => ({ line: index + 1, text })),
    more,
  });

  it("shows the first five and counts the rest, without those just ticked", () => {
    const log = note("projects/house/log.md", ["a", "b", "c", "d"], 2);
    const roof = note("projects/house/roof.md", ["e", "f", "g"]);
    const result = { notes: [log, roof], totalOpen: 9 };
    const all = topicPanelTodos(result, "projects/house", new Set());
    expect(all.rows.map((row) => row.todo.text)).toEqual(["a", "b", "c", "d", "e"]);
    expect(all.more).toBe(4);

    const ticked = new Set([todoKey(log.path, log.todos[0]!)]);
    const after = topicPanelTodos(result, "projects/house/", ticked);
    expect(after.rows.map((row) => row.todo.text)).toEqual(["b", "c", "d", "e", "f"]);
    expect(after.more).toBe(3);
  });

  it("keeps to the topic's folder when an older server answers for the whole notes folder", () => {
    const result = {
      notes: [
        note("daily/2026-11-16.md", ["x", "y"]),
        note("projects/house/log.md", ["a"]),
        note("projects/housework.md", ["z"]),
      ],
      totalOpen: 40,
    };
    const shown = topicPanelTodos(result, "projects/house", new Set());
    expect(shown.rows.map((row) => row.todo.text)).toEqual(["a"]);
    expect(shown.more).toBe(0);
  });
});

describe("topic panel routines", () => {
  const task = (id: string, overrides: Partial<ScheduledTask> = {}) =>
    ({
      id: ScheduledTaskId.make(id),
      title: id,
      projectId: ProjectId.make("notes"),
      enabled: true,
      schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1] },
      nextRunAt: "2026-11-23T08:00:00.000Z",
      threadId: chat,
      ...overrides,
    }) as ScheduledTask;
  const item = (environmentId: EnvironmentId, entry: ScheduledTask) => ({
    key: `${environmentId}:${entry.id}`,
    environmentId,
    task: entry,
    timeZone: "Europe/Paris",
  });

  it("lists what posts in this chat in plain words, and nothing tied elsewhere", () => {
    const rows = topicPanelRoutines(
      {
        routines: [
          item(mac, task("Weekly review")),
          item(mac, task("Paused", { enabled: false, nextRunAt: null })),
          item(mac, task("Other chat", { threadId: ThreadId.make("other") })),
          item(server, task("Same id, other computer")),
          item(mac, task("No chat", { threadId: null })),
        ],
        reminders: [
          item(
            mac,
            task("Call the plumber", {
              schedule: { type: "once", runAt: "2026-12-01T09:00:00.000Z" },
              nextRunAt: "2026-12-01T09:00:00.000Z",
            }),
          ),
        ],
      },
      { environmentId: mac, threadId: chat },
      reader,
    );
    expect(rows.map(({ key: _key, ...row }) => row)).toEqual([
      { title: "Weekly review", when: "Mondays at 9:00", off: false, to: "/routines" },
      { title: "Paused", when: "Mondays at 9:00", off: true, to: "/routines" },
      { title: "Call the plumber", when: "Tue 1 Dec, 10:00", off: false, to: "/reminders" },
    ]);
  });
});

describe("topic panel chats", () => {
  const side = (id: string, environmentId = mac) => ({
    environmentId,
    threadId: ThreadId.make(id),
  });
  const shells: Record<string, { title: string; settledOverride: string | null }> = {
    quotes: { title: "Roof quotes", settledOverride: null },
    fresh: { title: "New thread", settledOverride: null },
    old: { title: "Boiler", settledOverride: "settled" },
  };
  const shellOf = (ref: { readonly threadId: ThreadId }) => shells[ref.threadId];

  it("splits the other chats into open and done, and leaves out the chat being read", () => {
    const own = topic({ sideChats: [side("quotes")] });
    const merged = topic({
      sideChats: [side("quotes"), side("fresh"), side("old"), side("unknown"), side("quotes")],
      otherChats: [side("house-on-server", server)],
    });
    const fromMain = topicPanelChats({
      own,
      merged,
      current: { environmentId: mac, threadId: chat },
      shellOf,
    });
    expect(fromMain.open.map((row) => row.title)).toEqual(["Roof quotes", "New chat"]);
    expect(fromMain.done.map((row) => row.title)).toEqual(["Boiler"]);
    expect(fromMain.elsewhere).toEqual([side("house-on-server", server)]);

    // Read from the server's own chat, the merged topic's chat is the one elsewhere.
    const fromServer = topicPanelChats({
      own,
      merged,
      current: side("house-on-server", server),
      shellOf,
    });
    expect(fromServer.elsewhere).toEqual([{ environmentId: mac, threadId: chat }]);
  });

  it("falls back to this computer's copy of the topic", () => {
    const only = topicPanelChats({
      own: topic({ sideChats: [side("quotes")] }),
      merged: undefined,
      current: { environmentId: mac, threadId: chat },
      shellOf,
    });
    expect(only.open.map((row) => row.title)).toEqual(["Roof quotes"]);
    expect(only.elsewhere).toEqual([]);
  });

  it("lists the topic's chats as tabs, the continuing chat first", () => {
    const own = topic({ sideChats: [side("quotes")] });
    const merged = topic({
      sideChats: [side("quotes"), side("fresh"), side("old"), side("unknown"), side("quotes")],
    });
    const fromMain = topicTabs({
      own,
      merged,
      current: { environmentId: mac, threadId: chat },
      shellOf,
    });
    expect(fromMain.main).toEqual({ environmentId: mac, threadId: chat });
    expect(fromMain.chats.map((tab) => tab.title)).toEqual(["Roof quotes", "New chat"]);

    // A chat marked as done keeps its tab while it is the one being read.
    const fromDone = topicTabs({ own, merged, current: side("old"), shellOf });
    expect(fromDone.main).toEqual({ environmentId: mac, threadId: chat });
    expect(fromDone.chats.map((tab) => [tab.title, tab.done])).toEqual([
      ["Roof quotes", false],
      ["New chat", false],
      ["Boiler", true],
    ]);

    // The main tab is the chat where the topic's conversations are kept. The continuing chat of
    // another computer has its own tab: listed once it has a message, and always while it is read.
    const onServer = topic({
      threadId: ThreadId.make("house-on-server"),
      threadEnvironmentId: server,
    });
    const fromServer = topicTabs({
      own: onServer,
      merged,
      current: side("house-on-server", server),
      shellOf,
    });
    expect(fromServer.main).toEqual({ environmentId: mac, threadId: chat });
    expect(fromServer.elsewhere).toEqual([side("house-on-server", server)]);
    const listed = topic({ otherChats: [side("house-on-server", server)] });
    expect(
      topicTabs({
        own: onServer,
        merged: listed,
        current: side("house-on-server", server),
        shellOf,
      }).elsewhere,
    ).toEqual([side("house-on-server", server)]);
    expect(fromMain.elsewhere).toEqual([]);
    // Kept on the server and not started there yet: no main tab, and this Mac's chat beside it.
    const keptOnServer = topic({ threadId: null, threadEnvironmentId: server });
    expect(
      topicTabs({
        own: topic(),
        merged: keptOnServer,
        current: { environmentId: mac, threadId: chat },
        shellOf,
      }),
    ).toMatchObject({ main: null, elsewhere: [{ environmentId: mac, threadId: chat }] });
    const unstarted = topic({ threadId: null, sideChats: [side("quotes")] });
    expect(
      topicTabs({ own: unstarted, merged: undefined, current: side("quotes"), shellOf }).main,
    ).toBeNull();
  });
});
