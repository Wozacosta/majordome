import { expect, it } from "vite-plus/test";

import type { TopicRow } from "./today.logic";
import { finishedTopics, foldSideChats, pinTopicChats, placeTopics } from "./topic.logic";

const topic = (id: string, threadId: string | null, preview: string | null = null): TopicRow => ({
  id,
  title: id,
  threadId,
  preview,
});

it("draws a topic on its conversation's row once that is listed, and apart until then", () => {
  const topics = [
    topic("Fitness", "t-1"),
    topic("Taxes", null),
    // Its conversation is not among the listed chats: archived, or not loaded on this phone.
    topic("Garden", "t-gone"),
  ];
  const placed = placeTopics(topics, new Set(["t-1", "t-other"]), "");
  expect([...placed.byThread.keys()]).toEqual(["t-1"]);
  expect(placed.byThread.get("t-1")?.title).toBe("Fitness");
  expect(placed.apart.map((row) => row.title)).toEqual(["Taxes", "Garden"]);
});

it("keeps only the matching topics apart during a search, by name or latest line", () => {
  const topics = [
    topic("Taxes", null, "File by April"),
    topic("Garden", null),
    topic("Fitness", "t-1"),
  ];
  const listed = new Set(["t-1"]);
  expect(placeTopics(topics, listed, "april").apart.map((row) => row.title)).toEqual(["Taxes"]);
  expect(placeTopics(topics, listed, "gard").apart.map((row) => row.title)).toEqual(["Garden"]);
  // A topic on a chat's row is found by the list's own search, so it stays there.
  expect(placeTopics(topics, listed, "nothing").byThread.size).toBe(1);
});

it("lists the topics marked as done, the latest first, with the way back to each", () => {
  const done = finishedTopics([
    {
      id: "a",
      title: "Move house",
      folder: "projects/move",
      threadId: "t-a",
      finishedAt: "2026-10-01",
    },
    { id: "b", title: "Fitness", folder: "projects/fitness", threadId: "t-b" },
    {
      id: "c",
      title: "Wedding",
      folder: "projects/wedding",
      threadId: null,
      finishedAt: "2026-11-01",
    },
  ]);
  expect(done.map((row) => [row.id, row.threadId])).toEqual([
    ["c", null],
    ["a", "t-a"],
  ]);
});

it("folds a topic's other chats under its row, and shows them there once unfolded", () => {
  // "label" stands for a row that is not a chat; "s-old" is a side chat of a topic not listed.
  const items = ["s-2", "chat", "t-1", "label", "s-1", "s-old"];
  const idOf = (item: string) => (item === "label" ? null : item);
  const topics = new Map([
    ["t-1", { id: "Fitness", sideThreadIds: ["s-1", "s-2"] }],
    ["t-gone", { id: "Garden", sideThreadIds: ["s-old"] }],
  ]);

  const folded = foldSideChats(items, idOf, topics, new Set());
  expect(folded.items).toEqual(["chat", "t-1", "label", "s-old"]);
  expect([...folded.counts]).toEqual([["t-1", 2]]);
  expect(folded.nested.size).toBe(0);

  const unfolded = foldSideChats(items, idOf, topics, new Set(["Fitness"]));
  expect(unfolded.items).toEqual(["chat", "t-1", "s-2", "s-1", "label", "s-old"]);
  expect([...unfolded.nested]).toEqual(["s-2", "s-1"]);
});

it("keeps the topics' conversations first, in the topics' order, whatever they are doing", () => {
  // As the list arrives: a shelf header, a working topic inside it, a chat, an older topic.
  const items = ["working-shelf", "t-taxes", "t-chat", "t-fitness"];
  const idOf = (item: string) => (item.startsWith("t-") ? item : null);
  expect(pinTopicChats(items, idOf, ["t-fitness", "t-taxes"])).toEqual({
    items: ["t-fitness", "t-taxes", "working-shelf", "t-chat"],
    pinned: 2,
  });
  expect(pinTopicChats(items, idOf, [])).toEqual({ items, pinned: 0 });
});
