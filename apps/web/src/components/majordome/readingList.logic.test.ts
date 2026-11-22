import type { MajordomeReadingItem } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  askAboutReadingMessage,
  canReorderReading,
  filterReadingItems,
  isReadingSnoozed,
  nextReadingItems,
  orderReadingItems,
  parseReadingMinutes,
  placeReadingItem,
  presentReadingKinds,
  readingAddedWords,
  readingBackOnWords,
  readingLengthWords,
  readingMoreWords,
  readingSnoozeDate,
  readingTagCounts,
  readingTimeLeftWords,
  splitSnoozedReading,
  withReadingTag,
} from "./readingList.logic";

const item = (id: string, over: Partial<MajordomeReadingItem> = {}): MajordomeReadingItem => ({
  id,
  url: `https://example.com/${id}`,
  title: `Title ${id}`,
  kind: "article",
  tags: [],
  addedAt: "2026-11-06T12:00:00.000Z",
  ...over,
});
const ids = (items: ReadonlyArray<MajordomeReadingItem>) => items.map((entry) => entry.id);
const NO_FILTERS = { kind: null, tag: null, hideFinished: false };

const list = [
  item("a", { tags: ["ml", "essay"], minutes: 45 }),
  item("b", { doneAt: "2026-11-10T08:00:00.000Z", tags: ["ml"], minutes: 10 }),
  item("c", { kind: "video", tags: ["design"], minutes: 116 }),
  item("d", { doneAt: "2026-11-12T08:00:00.000Z", kind: "paper" }),
  item("e", { kind: "video", tags: ["ml"] }),
];

it("puts unfinished first in the list's order, then finished by most recently finished", () => {
  expect(ids(orderReadingItems(list))).toEqual(["a", "c", "e", "d", "b"]);
});

it("filters by kind, by tag and by finished, together", () => {
  expect(ids(filterReadingItems(list, NO_FILTERS))).toEqual(["a", "b", "c", "d", "e"]);
  expect(ids(filterReadingItems(list, { ...NO_FILTERS, kind: "video" }))).toEqual(["c", "e"]);
  expect(ids(filterReadingItems(list, { ...NO_FILTERS, tag: "ml" }))).toEqual(["a", "b", "e"]);
  expect(ids(filterReadingItems(list, { kind: null, tag: "ml", hideFinished: true }))).toEqual([
    "a",
    "e",
  ]);
  expect(ids(filterReadingItems(list, { kind: "video", tag: "ml", hideFinished: true }))).toEqual([
    "e",
  ]);
});

it("allows dragging only while no kind or tag is chosen", () => {
  expect(canReorderReading({ ...NO_FILTERS, hideFinished: true })).toBe(true);
  expect(canReorderReading({ ...NO_FILTERS, kind: "video" })).toBe(false);
  expect(canReorderReading({ ...NO_FILTERS, tag: "ml" })).toBe(false);
});

it("lists the kinds present in their fixed order, and tags by how often they are used", () => {
  expect(presentReadingKinds(list)).toEqual(["article", "video", "paper"]);
  expect(readingTagCounts([...list, item("f", { tags: ["essay", "essay", "art"] })])).toEqual([
    { tag: "ml", count: 3 },
    { tag: "essay", count: 2 },
    { tag: "art", count: 1 },
    { tag: "design", count: 1 },
  ]);
});

it.each([
  [{ kind: "article", minutes: 12 }, "12 min read"],
  [{ kind: "repo", minutes: 60 }, "1 h read"],
  [{ kind: "video", minutes: 18 }, "18 min"],
  [{ kind: "podcast", minutes: 116 }, "1 h 56 min"],
  [{ kind: "paper", minutes: 0.2 }, "1 min read"],
  [{ kind: "doc", minutes: 0 }, null],
  [{ kind: "other" }, null],
] as const)("words the length of %o", (entry, expected) => {
  expect(readingLengthWords(entry)).toBe(expected);
});

it("adds up the time left over unfinished rows only", () => {
  expect(readingTimeLeftWords(list)).toBe("2 h 41 min to go · 3 items");
  expect(readingTimeLeftWords([item("a", { minutes: 9 })])).toBe("9 min to go · 1 item");
  expect(readingTimeLeftWords([item("a"), item("b")])).toBe("2 items");
  expect(readingTimeLeftWords([item("a", { doneAt: "2026-11-10T08:00:00.000Z" })])).toBeNull();
});

// Sunday 22 November 2026, 9:30 in the morning, wherever the test runs.
const NOW = new Date(2026, 10, 22, 9, 30);

it("hides a snoozed item until its day starts, and never a finished one", () => {
  const snoozed = (snoozedUntil: string, doneAt?: string) =>
    isReadingSnoozed({ snoozedUntil, ...(doneAt === undefined ? {} : { doneAt }) }, NOW);
  expect(snoozed("2026-11-23")).toBe(true);
  expect(snoozed("2027-01-01")).toBe(true);
  expect(snoozed("2026-11-22")).toBe(false);
  expect(snoozed("2026-11-01")).toBe(false);
  // A time written by hand counts to the minute; nonsense snoozes nothing.
  expect(snoozed(new Date(2026, 10, 22, 18, 0).toISOString())).toBe(true);
  expect(snoozed(new Date(2026, 10, 22, 9, 0).toISOString())).toBe(false);
  expect(snoozed("someday")).toBe(false);
  expect(snoozed("2026-11-23", "2026-11-10T08:00:00.000Z")).toBe(false);
  expect(isReadingSnoozed({}, NOW)).toBe(false);
});

it("sets snoozed items apart, soonest back first, and leaves them out of the time to go", () => {
  const withSnoozed = [
    item("s1", { snoozedUntil: "2026-12-22", minutes: 300 }),
    ...list,
    item("s2", { snoozedUntil: "2026-11-23", minutes: 30 }),
    item("woken", { snoozedUntil: "2026-11-22", minutes: 5 }),
  ];
  const { awake, snoozed } = splitSnoozedReading(withSnoozed, NOW);
  expect(ids(awake)).toEqual(["a", "b", "c", "d", "e", "woken"]);
  expect(ids(snoozed)).toEqual(["s2", "s1"]);
  expect(readingTimeLeftWords(awake)).toBe("2 h 46 min to go · 4 items");
  // The day after, the first one is back in its place on its own.
  expect(ids(splitSnoozedReading(withSnoozed, new Date(2026, 10, 23, 0, 0)).snoozed)).toEqual([
    "s1",
  ]);
});

it("picks the first three unfinished, unsnoozed things as next and counts the rest", () => {
  const long = [
    item("s", { snoozedUntil: "2026-11-23", minutes: 500 }),
    ...list,
    item("f", { minutes: 24 }),
    item("g"),
  ];
  const { next, later } = nextReadingItems(long, NOW);
  expect(ids(next)).toEqual(["a", "c", "e"]);
  expect(ids(later)).toEqual(["f", "g"]);
  expect(readingMoreWords(later)).toBe("2 more on your list · 24 min");
  expect(readingMoreWords([item("g")])).toBe("1 more on your list");
  expect(readingMoreWords([])).toBeNull();
  expect(
    nextReadingItems(
      [
        item("done", { doneAt: "2026-11-10T08:00:00.000Z" }),
        item("s", { snoozedUntil: "2026-11-23" }),
      ],
      NOW,
    ),
  ).toEqual({
    next: [],
    later: [],
  });
});

it.each([
  ["tomorrow", new Date(2026, 10, 22, 23, 59), "2026-11-23"],
  ["tomorrow", new Date(2026, 11, 31, 8, 0), "2027-01-01"],
  ["week", new Date(2026, 10, 27, 8, 0), "2026-12-04"],
  ["month", new Date(2026, 10, 22, 8, 0), "2026-12-22"],
  ["month", new Date(2027, 0, 31, 8, 0), "2027-02-28"],
  ["month", new Date(2026, 11, 15, 8, 0), "2027-01-15"],
] as const)("snoozes until %s from %s: %s", (choice, now, expected) => {
  expect(readingSnoozeDate(choice, now)).toBe(expected);
});

it("words the day a snoozed item is back", () => {
  expect(readingBackOnWords("2026-12-02", NOW)).toBe("back on Wed 2 Dec");
  expect(readingBackOnWords("2027-01-04", NOW)).toBe("back on Mon 4 Jan 2027");
  expect(readingBackOnWords("someday", NOW)).toBe("");
});

it("moves a dropped row among the unfinished ones and leaves finished rows where they were", () => {
  // On screen: a, c, e, then the finished d and b.
  expect(placeReadingItem(list, "a", "e")).toEqual(["c", "b", "e", "d", "a"]);
  expect(placeReadingItem(list, "e", "a")).toEqual(["e", "b", "a", "d", "c"]);
  expect(placeReadingItem(list, "a", "c")).toEqual(["c", "b", "a", "d", "e"]);
  expect(placeReadingItem(list, "a", "a")).toEqual(["a", "b", "c", "d", "e"]);
  expect(placeReadingItem(list, "a", "b")).toEqual(["a", "b", "c", "d", "e"]);
  expect(placeReadingItem(list, "gone", "a")).toEqual(["a", "b", "c", "d", "e"]);
});

it("cleans a typed tag and refuses an empty or repeated one", () => {
  expect(withReadingTag(["ml"], "  #Local-First ")).toEqual(["ml", "local-first"]);
  expect(withReadingTag(["ml"], "ML")).toBeNull();
  expect(withReadingTag(["ml"], " # ")).toBeNull();
});

it.each([
  ["25", 25],
  [" 90 ", 90],
  ["", null],
  ["0", undefined],
  ["1.5", undefined],
  ["soon", undefined],
])("reads %o as a length", (typed, expected) => {
  expect(parseReadingMinutes(typed)).toBe(expected);
});

it("words the day something was added, with the year once it is another one", () => {
  expect(readingAddedWords("2026-11-06T12:00:00.000Z", new Date("2026-11-21T12:00:00.000Z"))).toBe(
    "Nov 6",
  );
  expect(readingAddedWords("2025-03-02T12:00:00.000Z", new Date("2026-11-21T12:00:00.000Z"))).toBe(
    "Mar 2, 2025",
  );
  expect(readingAddedWords("never", new Date("2026-11-21T12:00:00.000Z"))).toBe("");
});

it("asks the assistant for a preview before reading and a quiz after", () => {
  expect(askAboutReadingMessage(item("a"))).toBe(
    "About “Title a” on my reading list (https://example.com/a): tell me in a few lines what it covers and whether it is worth my time.",
  );
  expect(askAboutReadingMessage(item("a", { url: null, doneAt: "2026-11-10T08:00:00.000Z" }))).toBe(
    "About “Title a” on my reading list: quiz me on it with three short questions, then save what I want to remember as its note.",
  );
});
