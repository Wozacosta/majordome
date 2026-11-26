import { expect, it } from "vite-plus/test";

import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import {
  forgetRemovedComputers,
  friendlyDate,
  noteLines,
  noteSections,
  toggleTodo,
  topicRows,
  type TodayStore,
} from "./today.logic";

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
    { kind: "heading", text: "Monday", level: 1, index: 3 },
    { kind: "todo", text: "Call the bank", done: false, depth: 0, index: 5 },
    { kind: "todo", text: "Find the IBAN", done: true, depth: 1, index: 6 },
    { kind: "bullet", text: "09:12 bought bread", depth: 0, index: 7 },
    { kind: "text", text: "plain", depth: 0, index: 8 },
  ]);
});

it("keeps how deep a line sits under the list items above it, whatever the indent width", () => {
  const nested = ["- a", "    - b", "        - [ ] c", "      still c", "    - d", "---", "- e"];
  expect(
    noteLines(nested.join("\n")).map((line) => [line.text, "depth" in line && line.depth]),
  ).toEqual([
    ["a", 0],
    ["b", 1],
    ["c", 2],
    ["still c", 2],
    ["d", 1],
    ["e", 0],
  ]);
});

it("groups the note under its main headings and leaves out the one that only names the day", () => {
  const note = [
    "before",
    "# 2026-11-23",
    "## Top priorities",
    "- [ ] Call",
    "### Later",
    "## Notes",
  ];
  const sections = noteSections(note.join("\n"), "2026-11-23");
  expect(sections.map((section) => [section.index, section.title, section.lines.length])).toEqual([
    [-1, null, 1],
    [2, "Top priorities", 2],
    [5, "Notes", 0],
  ]);
  expect(noteSections("# Monday, 23 November\ntext", "2026-11-23")).toEqual([
    { index: -1, title: null, lines: [{ kind: "text", text: "text", depth: 0, index: 1 }] },
  ]);
});

it("says a day the way a person would", () => {
  expect(friendlyDate("2026-11-23")).toBe("Monday 23 November");
  expect(friendlyDate("2027-01-01")).toBe("Friday 1 January");
  expect(friendlyDate("someday")).toBe("someday");
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
        folder: "projects/fitness",
        threadId: "t1",
        lastMessagePreview: { author: "you", text: "ran 5k" },
      },
      {
        id: "b",
        title: "Paperwork",
        folder: "admin",
        icon: "receipt",
        threadId: null,
        standing: { text: "Waiting on the form\nThen file" },
        notesCount: 4,
      },
      { id: "c", title: "Old", folder: "old", threadId: "t3", finishedAt: "2026-01-01" },
    ]),
  ).toEqual([
    {
      id: "a",
      title: "Fitness",
      threadId: "t1",
      preview: "You: ran 5k",
      icon: "dumbbell",
      tone: "orange",
    },
    {
      id: "b",
      title: "Paperwork",
      threadId: null,
      preview: "Waiting on the form",
      icon: "receipt",
      tone: "teal",
      notes: 4,
    },
  ]);
});

const MAC = EnvironmentId.make("mac");
const OTHER = EnvironmentId.make("other");
const capture = (environmentId: EnvironmentId) => ({
  id: `line-${environmentId}`,
  environmentId,
  projectId: ProjectId.make("notes"),
  date: "2026-11-26",
  time: "09:12",
  text: "bought bread",
});
const KEPT: TodayStore = {
  vault: { environmentId: MAC, projectId: ProjectId.make("notes") },
  note: { date: "2026-11-26", content: "# Thursday" },
  captures: [capture(MAC), capture(OTHER)],
  topics: [{ id: "accounting", title: "Accounting", threadId: null, preview: null }],
  hiddenRoutines: ["Morning brief"],
};

it("forgets the note, topics and waiting lines of a computer the phone no longer has", () => {
  expect(forgetRemovedComputers(KEPT, (id) => id === OTHER)).toEqual({
    vault: null,
    note: null,
    captures: [capture(OTHER)],
    topics: [],
  });
});

it("keeps the phone's copy while its computer is still there", () => {
  const both = forgetRemovedComputers(KEPT, () => true);
  expect(both).toBe(KEPT);
  expect(forgetRemovedComputers(KEPT, (id) => id === MAC)).toEqual({
    ...KEPT,
    captures: [capture(MAC)],
  });
});
