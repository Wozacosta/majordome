import { expect, it } from "vite-plus/test";

import {
  canStartFirstChat,
  chatMatchesSearch,
  chatMenuActions,
  chatRestLine,
  chatRowLabel,
  chatStatusLine,
  chatTitle,
  chatWantsAttention,
  keepsChatTitle,
  orderChatsByActivity,
  topicLine,
  topicMenuActions,
} from "./chat.logic";

it("shows a chat not named yet as a new chat, and renaming it to that changes nothing", () => {
  expect(chatTitle("New thread")).toBe("New chat");
  expect(chatTitle("Taxes 2026")).toBe("Taxes 2026");
  expect(keepsChatTitle(" New chat ", "New thread")).toBe(true);
  expect(keepsChatTitle("Holiday plans", "New thread")).toBe(false);
});

it("says what a chat is doing in plain words, and nothing when it is at rest and read", () => {
  expect(chatStatusLine("working", false)).toEqual({ words: "Working…", tone: "working" });
  expect(chatStatusLine("input", true)).toEqual({
    words: "Waiting for your answer",
    tone: "asking",
  });
  expect(chatStatusLine("ready", true)).toEqual({ words: "New reply", tone: "new" });
  expect(chatStatusLine("ready", false)).toBeNull();
  expect(chatWantsAttention(chatStatusLine("approval", false))).toBe(true);
  expect(chatWantsAttention(chatStatusLine("ready", true))).toBe(true);
  expect(chatWantsAttention(chatStatusLine("working", false))).toBe(false);
  expect(chatWantsAttention(null)).toBe(false);
});

it("gives a topic its status first, then its latest message, then where it stands", () => {
  const topic = { preview: "You: ran 5k", notes: 3 };
  expect(topicLine(topic, chatStatusLine("working", false)).words).toBe("Working…");
  expect(topicLine(topic, chatStatusLine("ready", true))).toEqual({
    words: "You: ran 5k",
    tone: "new",
  });
  expect(topicLine(topic, null)).toEqual({ words: "You: ran 5k", tone: "plain" });
  expect(topicLine({ preview: null }, chatStatusLine("ready", true)).words).toBe("New reply");
  expect(topicLine({ preview: null, notes: 3 }, null).words).toBe("3 notes · no messages yet");
  expect(topicLine({ preview: null, notes: 1 }, null).words).toBe("1 note · no messages yet");
  expect(topicLine({ preview: null }, null).words).toBe("No messages yet");
});

it("shows where a read topic stands rather than an old message", () => {
  const topic = { preview: "Done, it is paid.", standing: "Electricity bill paid, €84" };
  expect(topicLine(topic, null)).toEqual({ words: "Electricity bill paid, €84", tone: "plain" });
  // Unread, the reply itself is what there is to see; a status still comes first.
  expect(topicLine(topic, chatStatusLine("ready", true))).toEqual({
    words: "Done, it is paid.",
    tone: "new",
  });
  expect(topicLine(topic, chatStatusLine("approval", false)).words).toBe("Needs your OK");
});

it("reads a row aloud with its unread reply named once", () => {
  expect(
    chatRowLabel({ title: "Fitness", line: { words: "Nice run", tone: "new" }, time: "5m" }),
  ).toBe("Fitness, New reply, Nice run, 5m");
  expect(chatRowLabel({ title: "New chat", line: chatStatusLine("ready", true), time: null })).toBe(
    "New chat, New reply",
  );
  expect(chatRowLabel({ title: "Taxes", line: null, time: "2d" })).toBe("Taxes, 2d");
});

it("says who spoke last in a chat at rest, since the list carries no message text", () => {
  expect(chatRestLine({ latestUserMessageAt: null, latestRun: null })?.words).toBe(
    "No messages yet",
  );
  expect(
    chatRestLine({
      latestUserMessageAt: "2026-11-23T10:00:00.000Z",
      latestRun: { completedAt: "2026-11-23T10:01:00.000Z" },
    })?.words,
  ).toBe("Replied");
  // The owner wrote after the last reply, and nothing answered.
  expect(
    chatRestLine({
      latestUserMessageAt: "2026-11-23T10:05:00.000Z",
      latestRun: { completedAt: "2026-11-23T10:01:00.000Z" },
    }),
  ).toBeNull();
  expect(
    chatRestLine({ latestUserMessageAt: "2026-11-23T10:05:00.000Z", latestRun: null }),
  ).toBeNull();
  expect(
    chatRestLine(
      {
        latestUserMessageAt: "2026-11-23T10:00:00.000Z",
        latestRun: { completedAt: "2026-11-23T10:01:00.000Z" },
      },
      "Mac mini",
    )?.words,
  ).toBe("Replied · Mac mini");
});

it("reads a topic, a pinned row and a done row as such", () => {
  expect(
    chatRowLabel({
      title: "Fitness",
      topic: true,
      line: { words: "You: ran 5k", tone: "plain" },
      time: "2h",
      pinned: true,
    }),
  ).toBe("Fitness, topic, You: ran 5k, 2h, pinned");
  expect(chatRowLabel({ title: "Taxes", line: null, time: "3d", done: true })).toBe(
    "Taxes, 3d, done",
  );
});

it("keeps a chat's menu to one short list in a fixed order, whatever upstream nests", () => {
  expect(
    chatMenuActions([
      { id: "new-thread-on-branch" },
      { id: "copy-thread" },
      { id: "settle" },
      { id: "snooze", subactions: [{ id: "snooze:tomorrow" }] },
      { id: "pin" },
      {
        id: "more",
        subactions: [
          { id: "arrange-menu", subactions: [{ id: "arrange" }, { id: "move-up" }] },
          { id: "rename" },
          { id: "regenerate-title" },
          { id: "mark-unread" },
          { id: "turn-into-project" },
          { id: "auto-settle", subactions: [{ id: "auto-settle:enabled" }] },
          { id: "archive" },
          { id: "delete" },
        ],
      },
      { id: "copy-thread-id" },
    ]),
  ).toEqual([
    { id: "pin" },
    { id: "rename" },
    { id: "mark-unread" },
    { id: "snooze", subactions: [{ id: "snooze:tomorrow" }] },
    { id: "settle" },
    { id: "delete" },
  ]);
});

it("gives a topic its own menu: no rename, no delete, and done means the topic", () => {
  expect(
    topicMenuActions(
      [
        { id: "unpin" },
        { id: "rename" },
        { id: "mark-unread" },
        { id: "settle" },
        { id: "delete" },
      ],
      "Fitness",
    ).map((action) => action.id),
  ).toEqual(["topic-side-chat", "unpin", "mark-unread", "topic-finish"]);
});

it("finds a row by its title or its line, whatever the case", () => {
  expect(chatMatchesSearch(" FIT ", { title: "Fitness" })).toBe(true);
  expect(chatMatchesSearch("5k", { title: "Fitness", preview: "You: ran 5K" })).toBe(true);
  expect(chatMatchesSearch("taxes", { title: "Fitness", preview: null })).toBe(false);
  expect(chatMatchesSearch("", { title: "Fitness" })).toBe(true);
});

it("orders open chats by what moved last and leaves pinned rows and shelves where they are", () => {
  const row = (
    key: string,
    at: string | null,
    extra: { variant?: string; pinned?: boolean; snoozed?: boolean } = {},
  ) => ({
    type: "v2-thread",
    key,
    at,
    item: { variant: "card", pinned: false, snoozed: false, ...extra },
  });
  const shelf = (key: string) => ({ type: "v2-settled-shelf", key, at: null });
  const items = [
    { type: "v2-pending", key: "unsent", at: null },
    row("pinned-old", "2026-11-01T00:00:00.000Z", { pinned: true }),
    row("monday", "2026-11-16T00:00:00.000Z"),
    row("never", null),
    row("today", "2026-11-23T00:00:00.000Z"),
    shelf("done"),
    row("done-old", "2026-10-01T00:00:00.000Z", { variant: "slim" }),
    row("done-new", "2026-11-22T00:00:00.000Z", { variant: "slim" }),
  ];
  const ordered = orderChatsByActivity(items, (item) => item.at);
  expect(ordered.map((item) => item.key)).toEqual([
    "unsent",
    "pinned-old",
    "today",
    "monday",
    "never",
    "done",
    "done-old",
    "done-new",
  ]);
  expect(items[2]?.key).toBe("monday");
});

it("offers a first chat only once a computer answers and has a notes folder", () => {
  expect(canStartFirstChat({ loading: false, hasReadyComputer: true, folders: 1 })).toBe(true);
  expect(canStartFirstChat({ loading: true, hasReadyComputer: true, folders: 1 })).toBe(false);
  expect(canStartFirstChat({ loading: false, hasReadyComputer: false, folders: 1 })).toBe(false);
  expect(canStartFirstChat({ loading: false, hasReadyComputer: true, folders: 0 })).toBe(false);
});
