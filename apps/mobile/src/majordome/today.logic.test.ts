import { expect, it } from "vite-plus/test";

import { noteLines, toggleTodo, topicRows } from "./today.logic";

const NOTE = [
  "---",
  "tags: [daily]",
  "---",
  "# Monday",
  "",
  "1. [ ] **Call** the [bank](../bank.md)",
  "  - [x] Find the IBAN",
  "- 09:12 bought bread",
  "plain",
].join("\n");

it("lists a day's note without its frontmatter, with to-dos tickable by line", () => {
  expect(noteLines(NOTE)).toEqual([
    { kind: "heading", text: "Monday", index: 3 },
    { kind: "todo", text: "Call the bank", done: false, index: 5 },
    { kind: "todo", text: "Find the IBAN", done: true, index: 6 },
    { kind: "text", text: "• 09:12 bought bread", index: 7 },
    { kind: "text", text: "plain", index: 8 },
  ]);
});

it("ticks and unticks one to-do and leaves every other line alone", () => {
  const ticked = toggleTodo(NOTE, 5);
  expect(ticked.split("\n")[5]).toBe("1. [x] **Call** the [bank](../bank.md)");
  expect(toggleTodo(ticked, 5)).toBe(NOTE);
  expect(toggleTodo(NOTE, 6).split("\n")[6]).toBe("  - [ ] Find the IBAN");
  expect(toggleTodo(NOTE, 3)).toBe(NOTE);
});

it("lists the topics still going with their latest message, else where they stand", () => {
  expect(
    topicRows([
      {
        id: "a",
        title: "Fitness",
        threadId: "t1",
        lastMessagePreview: { author: "you", text: "ran 5k" },
      },
      {
        id: "b",
        title: "Taxes",
        threadId: null,
        standing: { text: "Waiting on the form\nThen file" },
      },
      { id: "c", title: "Old", threadId: "t3", finishedAt: "2026-01-01" },
    ]),
  ).toEqual([
    { id: "a", title: "Fitness", threadId: "t1", preview: "You: ran 5k" },
    { id: "b", title: "Taxes", threadId: null, preview: "Waiting on the form" },
  ]);
});
