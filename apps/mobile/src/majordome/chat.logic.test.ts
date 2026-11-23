import { expect, it } from "vite-plus/test";

import {
  chatMenuActions,
  chatRowLabel,
  chatStatusLine,
  chatTitle,
  chatWantsAttention,
  keepsChatTitle,
  topicLine,
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

it("reads a row aloud with its unread reply named once", () => {
  expect(
    chatRowLabel({ title: "Fitness", line: { words: "Nice run", tone: "new" }, time: "5m" }),
  ).toBe("Fitness, New reply, Nice run, 5m");
  expect(chatRowLabel({ title: "New chat", line: chatStatusLine("ready", true), time: null })).toBe(
    "New chat, New reply",
  );
  expect(chatRowLabel({ title: "Taxes", line: null, time: "2d" })).toBe("Taxes, 2d");
});

it("takes the entries about code out of a chat's menu, nested ones too", () => {
  expect(
    chatMenuActions([
      { id: "new-thread-on-branch" },
      { id: "settle" },
      { id: "more", subactions: [{ id: "rename" }, { id: "turn-into-project" }] },
      { id: "copy-thread-id" },
    ]),
  ).toEqual([{ id: "settle" }, { id: "more", subactions: [{ id: "rename" }] }]);
});
